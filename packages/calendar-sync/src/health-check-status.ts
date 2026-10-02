import type { Env } from "@domi-ops/config";
import { decryptSensitive } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthCheckLogs,
  healthCheckPauses,
  healthEvents,
  healthVitalsReadings,
} from "@domi-ops/db";
import type { healthChecks } from "@domi-ops/db";
import { and, between, eq, inArray } from "drizzle-orm";
import { parseFixedTimeSchedule } from "./health-schedule.js";
import {
  CHECK_SLOT_TOLERANCE_MS,
  computeSlotStatuses,
  eventQualifiesForCheck,
  excludeInactiveInstants,
  intervalCheckSlots,
  scheduledCheckSlots,
  type CheckSlotEvent,
  type CheckSlotLog,
  type PausePeriod,
  type SlotResult,
} from "./health-check-slots.js";
import { parseCheckTemplate } from "./health-check-template.js";
import { addDaysIso, localDateOfInstant, zonedLocalToUtc } from "./household-time.js";
import { parseIntervalSchedule, type IntervalLog } from "./med-interval-schedule.js";

type HealthCheckRow = typeof healthChecks.$inferSelect;

/**
 * Stored health text is encrypted with `enc:v1:`. A template that can't be read (key changed or
 * missing) is treated as empty rather than throwing: the reminder worker must not abort a scan
 * over every household because of one unreadable field, and an empty template only means an
 * unlinked vitals entry is matched on type and person alone.
 */
function readTemplateText(value: string | null, env: Env): string | null {
  if (!value) return null;
  if (!value.startsWith("enc:v1:")) return value;
  if (!env.ENCRYPTION_KEY) return null;
  try {
    return decryptSensitive(value, env.ENCRYPTION_KEY);
  } catch {
    return null;
  }
}

/** Local dates `from`..`to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/**
 * Status of every slot of `checks` over the local dates `from`..`to` in `timeZone`.
 *
 * This is the one place that gathers what the pure slot logic needs (logs, nearby entries, the
 * vitals metrics they hold, pauses) so the dashboard, the Today tab and the reminder worker all get
 * the same answer. It deliberately looks at *all* of the person's entries, not only the ones the
 * caller may open: whether a slot was done is part of the check, and a viewer a private check was
 * shared with would otherwise see it "overdue" forever. What it must not do is hand out the
 * entries themselves, so callers decide which `eventId`s they may reveal.
 *
 * All `checks` must belong to one household.
 */
export async function loadCheckSlotStatuses(
  db: Database,
  env: Env,
  input: {
    checks: HealthCheckRow[];
    from: string;
    to: string;
    timeZone: string;
    now: Date;
    /** See `intervalCheckSlots`. Reminders pass false. */
    includeAwaitingFirst?: boolean;
  },
): Promise<Map<string, SlotResult[]>> {
  const result = new Map<string, SlotResult[]>();
  const { checks, timeZone, now } = input;
  if (checks.length === 0) return result;

  const dates = datesBetween(input.from, input.to);
  // The days asked for, and that range padded by the tolerance: slots only come from the first,
  // but a reading just outside the range can still complete a slot on its edge.
  const rangeStart = zonedLocalToUtc(input.from, "00:00", timeZone);
  const rangeEnd = zonedLocalToUtc(addDaysIso(input.to, 1), "00:00", timeZone);
  const windowStart = new Date(rangeStart.getTime() - CHECK_SLOT_TOLERANCE_MS);
  const windowEnd = new Date(rangeEnd.getTime() + CHECK_SLOT_TOLERANCE_MS);
  const checkIds = checks.map((c) => c.id);
  const householdId = checks[0]!.householdId;
  const today = localDateOfInstant(now, timeZone);

  const pauseRows = await db.select().from(healthCheckPauses).where(inArray(healthCheckPauses.checkId, checkIds));
  const pausesByCheck = new Map<string, PausePeriod[]>();
  for (const p of pauseRows) {
    const list = pausesByCheck.get(p.checkId) ?? [];
    list.push({ pausedAt: p.pausedAt, resumedAt: p.resumedAt });
    pausesByCheck.set(p.checkId, list);
  }

  const logRows = await db
    .select()
    .from(healthCheckLogs)
    .where(and(inArray(healthCheckLogs.checkId, checkIds), between(healthCheckLogs.scheduledAt, windowStart, windowEnd)));

  const eventRows = await db
    .select({
      id: healthEvents.id,
      memberId: healthEvents.memberId,
      type: healthEvents.type,
      startedAt: healthEvents.startedAt,
    })
    .from(healthEvents)
    .where(
      and(
        eq(healthEvents.householdId, householdId),
        inArray(healthEvents.memberId, [...new Set(checks.map((c) => c.memberId))]),
        inArray(healthEvents.type, [...new Set(checks.map((c) => c.eventType))]),
        between(healthEvents.startedAt, windowStart, windowEnd),
      ),
    );

  // An entry linked to a slot outside the window is still spoken for, so find every link to the
  // entries we are about to consider, wherever its slot is.
  const seenLogIds = new Set(logRows.map((l) => l.id));
  const extraLinks =
    eventRows.length > 0
      ? await db
          .select()
          .from(healthCheckLogs)
          .where(
            and(
              inArray(healthCheckLogs.checkId, checkIds),
              inArray(healthCheckLogs.healthEventId, eventRows.map((e) => e.id)),
            ),
          )
      : [];
  const allLogs = [...logRows, ...extraLinks.filter((l) => !seenLogIds.has(l.id))];

  // Which metrics each vitals entry holds, so a weight-only entry can't complete a BP check.
  const vitalsIds = eventRows.filter((e) => e.type === "vitals").map((e) => e.id);
  const metricsByEvent = new Map<string, string[]>();
  if (vitalsIds.length > 0) {
    const readings = await db
      .select({ eventId: healthVitalsReadings.eventId, metric: healthVitalsReadings.metric })
      .from(healthVitalsReadings)
      .where(inArray(healthVitalsReadings.eventId, vitalsIds));
    for (const r of readings) {
      const list = metricsByEvent.get(r.eventId) ?? [];
      list.push(r.metric);
      metricsByEvent.set(r.eventId, list);
    }
  }
  const slotEvents: CheckSlotEvent[] = eventRows.map((e) => ({
    id: e.id,
    memberId: e.memberId,
    type: e.type,
    startedAt: e.startedAt,
    metrics: metricsByEvent.get(e.id),
  }));
  const eventTime = new Map(eventRows.map((e) => [e.id, e.startedAt] as const));

  for (const check of checks) {
    const template = parseCheckTemplate(readTemplateText(check.templateJson, env));
    const forCheck = {
      eventType: check.eventType,
      memberId: check.memberId,
      requiredMetrics: check.eventType === "vitals" ? template.metrics : undefined,
    };
    const logs: CheckSlotLog[] = allLogs
      .filter((l) => l.checkId === check.id)
      .map((l) => ({ id: l.id, scheduledAt: l.scheduledAt, status: l.status, healthEventId: l.healthEventId }));
    const pauses = pausesByCheck.get(check.id) ?? [];

    let slots: Date[];
    if (check.scheduleKind === "interval") {
      const schedule = parseIntervalSchedule(check.scheduleJson);
      if (!schedule) {
        result.set(check.id, []);
        continue;
      }
      // The interval engine runs off when readings were actually taken: linked ones through their
      // log, and unlinked ones that would qualify (so an ad-hoc reading starts / advances it too).
      const linkedIds = new Set(logs.map((l) => l.healthEventId).filter((id): id is string => id != null));
      const intervalLogs: IntervalLog[] = [
        ...allLogs
          .filter((l) => l.checkId === check.id)
          .map((l) => ({
            scheduledAt: l.scheduledAt,
            loggedAt: (l.healthEventId ? eventTime.get(l.healthEventId) : null) ?? l.loggedAt,
            status: l.status === "done" ? "taken" : l.status,
          })),
        ...slotEvents
          .filter((e) => !linkedIds.has(e.id) && e.startedAt && eventQualifiesForCheck(e, forCheck))
          .map((e) => ({ scheduledAt: null, loggedAt: e.startedAt!, status: "taken" })),
      ];
      const pending = intervalCheckSlots({
        schedule,
        dates,
        today,
        now,
        timeZone,
        logs: intervalLogs,
        startDate: check.startDate,
        endDate: check.endDate,
        pauses,
        deletedAt: check.deletedAt,
        includeAwaitingFirst: input.includeAwaitingFirst,
      });
      // Interval slots are dynamic, so answered ones exist only as logs: bring them in, held to
      // the same rules as the pending ones (inside the requested days, not paused, not deleted).
      const answered = excludeInactiveInstants(
        logs.map((l) => l.scheduledAt).filter((t) => t >= rangeStart && t < rangeEnd),
        pauses,
        check.deletedAt,
      );
      slots = [...pending, ...answered];
    } else {
      const schedule = parseFixedTimeSchedule(check.scheduleJson);
      slots = scheduledCheckSlots({
        times: schedule.times,
        daysOfWeek: schedule.daysOfWeek,
        startDate: check.startDate,
        endDate: check.endDate,
        dates,
        timeZone,
        pauses,
        deletedAt: check.deletedAt,
      });
    }

    result.set(
      check.id,
      computeSlotStatuses({
        check: forCheck,
        slots,
        logs,
        events: slotEvents.filter((e) => e.memberId === check.memberId && e.type === check.eventType),
        now,
      }),
    );
  }
  return result;
}
