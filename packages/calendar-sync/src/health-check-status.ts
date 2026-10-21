import type { Env } from "@domi-ops/config";
import { decryptSensitive } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthCheckLogs,
  healthCheckPauses,
  healthEvents,
  healthVitalsReadings,
  healthWithingsMeasureGroups,
} from "@domi-ops/db";
import type { healthChecks } from "@domi-ops/db";
import { and, between, eq, inArray } from "drizzle-orm";
import { parseFixedTimeSchedule } from "./health-schedule.js";
import {
  CHECK_ATTACH_SUGGEST_RADIUS_MS,
  CHECK_SLOT_TOLERANCE_MS,
  computeSlotStatuses,
  eventQualifiesForCheck,
  excludeInactiveInstants,
  intervalCheckSlots,
  scheduledCheckSlots,
  suggestAttachments,
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

/** Everything the pure slot logic needs about a set of checks, gathered once. */
type SlotData = {
  dates: string[];
  rangeStart: Date;
  rangeEnd: Date;
  today: string;
  pausesByCheck: Map<string, PausePeriod[]>;
  allLogs: (typeof healthCheckLogs.$inferSelect)[];
  slotEvents: CheckSlotEvent[];
  eventTime: Map<string, Date | null>;
};

/**
 * The queries behind `loadCheckSlotStatuses` and `loadCheckIntervalLogs`: pauses, logs (and every
 * link to the entries considered), nearby entries, their metrics and Withings provenance. Six
 * queries however many checks there are. All `checks` must belong to one household.
 */
async function gatherSlotData(
  db: Database,
  input: {
    checks: HealthCheckRow[];
    from: string;
    to: string;
    timeZone: string;
    now: Date;
    /** Look this much further back for readings (see `loadCheckIntervalLogs`). */
    lookbackMinutes?: number;
    /** How far past each end of the range to look for readings. Defaults to the slot tolerance. */
    paddingMs?: number;
  },
): Promise<SlotData> {
  const { checks, timeZone, now } = input;
  const dates = datesBetween(input.from, input.to);
  // The days asked for, and that range padded by the tolerance: slots only come from the first,
  // but a reading just outside the range can still complete a slot on its edge.
  const rangeStart = zonedLocalToUtc(input.from, "00:00", timeZone);
  const rangeEnd = zonedLocalToUtc(addDaysIso(input.to, 1), "00:00", timeZone);
  // An interval counts from the last reading, which for "every 3 days" is older than the days asked
  // for: look back one full interval so the clock does not lose its anchor and offer a "first" slot.
  const intervalLookbackMs =
    Math.max(
      input.lookbackMinutes ?? 0,
      ...checks
        .filter((c) => c.scheduleKind === "interval")
        .map((c) => parseIntervalSchedule(c.scheduleJson)?.everyMinutes ?? 0),
    ) * 60_000;
  const padding = input.paddingMs ?? CHECK_SLOT_TOLERANCE_MS * 2;
  const windowStart = new Date(rangeStart.getTime() - padding - intervalLookbackMs);
  const windowEnd = new Date(rangeEnd.getTime() + padding);
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
  if (vitalsIds.length > 0) {
    const imported = await db.select({ eventId: healthWithingsMeasureGroups.eventId })
      .from(healthWithingsMeasureGroups)
      .where(and(eq(healthWithingsMeasureGroups.householdId, householdId), inArray(healthWithingsMeasureGroups.eventId, vitalsIds)));
    const importedIds = new Set(imported.map((e) => e.eventId));
    for (const event of slotEvents) event.withings = importedIds.has(event.id);
  }
  const eventTime = new Map(eventRows.map((e) => [e.id, e.startedAt] as const));

  return { dates, rangeStart, rangeEnd, today, pausesByCheck, allLogs, slotEvents, eventTime };
}

/**
 * What the interval engine sees for one check: when readings were actually taken. Linked ones come
 * through their log, and unlinked ones that would qualify count too (so an ad-hoc reading starts /
 * advances it). "Every N hours from the last one" runs off the reading, not off the tap.
 */
function intervalLogsFor(
  check: HealthCheckRow,
  data: SlotData,
  forCheck: { eventType: string; memberId: string; requiredMetrics?: readonly string[] },
): IntervalLog[] {
  const own = data.allLogs.filter((l) => l.checkId === check.id);
  const linkedIds = new Set(own.map((l) => l.healthEventId).filter((id): id is string => id != null));
  return [
    ...own.map((l) => ({
      scheduledAt: l.scheduledAt,
      loggedAt: (l.healthEventId ? data.eventTime.get(l.healthEventId) : null) ?? l.loggedAt,
      status: l.status === "done" ? "taken" : l.status,
    })),
    ...data.slotEvents
      .filter((e) => !linkedIds.has(e.id) && e.startedAt && eventQualifiesForCheck(e, forCheck))
      .map((e) => ({ scheduledAt: null, loggedAt: e.startedAt!, status: "taken" })),
  ];
}

function slotCheckFor(check: HealthCheckRow, env: Env) {
  const template = parseCheckTemplate(readTemplateText(check.templateJson, env));
  return {
    eventType: check.eventType,
    memberId: check.memberId,
    requiredMetrics: check.eventType === "vitals" ? template.metrics : undefined,
  };
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

  // Include neighboring days when assigning sessions, so querying one day or several gives the
  // same ownership for readings around midnight.
  const data = await gatherSlotData(db, { ...input, from: addDaysIso(input.from, -1), to: addDaysIso(input.to, 1) });
  const { dates, rangeStart, rangeEnd, today, pausesByCheck, allLogs, slotEvents } = data;
  const requestedStart = zonedLocalToUtc(input.from, "00:00", timeZone);
  const requestedEnd = zonedLocalToUtc(addDaysIso(input.to, 1), "00:00", timeZone);

  for (const check of checks) {
    const forCheck = slotCheckFor(check, env);
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
      const pending = intervalCheckSlots({
        schedule,
        dates,
        today,
        now,
        timeZone,
        logs: intervalLogsFor(check, data, forCheck),
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
        combineWithings: check.scheduleKind !== "interval",
      }).filter((s) => s.scheduledAt >= requestedStart && s.scheduledAt < requestedEnd),
    );
  }
  return result;
}

export type AttachSuggestion = { eventId: string; startedAt: Date };

/**
 * For each unanswered slot of `checks`, a reading the person could attach to it: one that qualifies for
 * the check but is not yet linked to any of its slots or counted for one, and is within
 * `CHECK_ATTACH_SUGGEST_RADIUS_MS` of the slot. Pairing is closest-first and one reading goes to one
 * slot, so a reading is never offered twice (see `suggestAttachments`).
 *
 * `statuses` must be what `loadCheckSlotStatuses` returned for the same `checks` and range. Only
 * fixed-time checks get suggestions: an interval check's slots are made from the readings, so there is
 * nothing to attach a stray one to. Returns checkId -> slot instant (ms) -> suggestion. Like the
 * statuses, this looks at all of the person's entries; callers decide which ones they may reveal.
 */
export async function loadAttachSuggestions(
  db: Database,
  env: Env,
  input: {
    checks: HealthCheckRow[];
    statuses: Map<string, SlotResult[]>;
    from: string;
    to: string;
    timeZone: string;
    now: Date;
    /**
     * Which of these entries the caller may open. Applied to the candidates *before* they are paired with
     * slots: otherwise a reading the caller can't open could win the closest-first match and then be
     * dropped by the route, leaving a farther reading they could attach un-offered. Leave it out only
     * when every entry is fair game (the reminder worker never asks).
     */
    canOpen?: (eventIds: string[]) => Promise<ReadonlySet<string>>;
  },
): Promise<Map<string, Map<number, AttachSuggestion>>> {
  const result = new Map<string, Map<number, AttachSuggestion>>();
  const openStatuses = new Set(["upcoming", "due", "overdue"]);
  const eligible = input.checks.filter(
    (c) => c.scheduleKind !== "interval" && (input.statuses.get(c.id) ?? []).some((s) => openStatuses.has(s.status)),
  );
  if (eligible.length === 0) return result;

  const data = await gatherSlotData(db, { ...input, checks: eligible, paddingMs: CHECK_ATTACH_SUGGEST_RADIUS_MS });
  // A reading can already count, on its own, for a slot on the day before or after the days asked for (a
  // 23:50 reading for a 23:45 check, viewed from the next day). `input.statuses` does not reach there, and
  // offering that reading would take it from the slot it completes, so judge "spoken for" over a day either
  // side. The offer radius is hours, so one day is always enough.
  const wide = await loadCheckSlotStatuses(db, env, {
    checks: eligible,
    from: addDaysIso(input.from, -1),
    to: addDaysIso(input.to, 1),
    timeZone: input.timeZone,
    now: input.now,
  });

  // Each check's own candidates: qualifying, and not spoken for by that check.
  const candidatesByCheck = new Map<string, CheckSlotEvent[]>();
  for (const check of eligible) {
    const spokenFor = new Set<string>();
    for (const l of data.allLogs) if (l.checkId === check.id && l.healthEventId) spokenFor.add(l.healthEventId);
    for (const s of wide.get(check.id) ?? []) {
      if (s.eventId) spokenFor.add(s.eventId);
      for (const id of s.eventIds ?? []) spokenFor.add(id);
    }
    const forCheck = slotCheckFor(check, env);
    candidatesByCheck.set(
      check.id,
      data.slotEvents.filter((e) => !spokenFor.has(e.id) && eventQualifiesForCheck(e, forCheck)),
    );
  }
  // One visibility lookup for all of them, before anything is paired.
  const openable = input.canOpen
    ? await input.canOpen([...new Set([...candidatesByCheck.values()].flat().map((e) => e.id))])
    : null;

  for (const check of eligible) {
    const slots = input.statuses.get(check.id) ?? [];
    const candidates = (candidatesByCheck.get(check.id) ?? []).filter((e) => !openable || openable.has(e.id));
    const matched = suggestAttachments({
      openSlots: slots.filter((s) => openStatuses.has(s.status)).map((s) => s.scheduledAt),
      events: candidates,
    });
    if (matched.size === 0) continue;
    const bySlot = new Map<number, AttachSuggestion>();
    for (const [slotMs, event] of matched) {
      if (event.startedAt) bySlot.set(slotMs, { eventId: event.id, startedAt: event.startedAt });
    }
    result.set(check.id, bySlot);
  }
  return result;
}

/**
 * What the interval engine sees for each of `checks` (see `intervalLogsFor`), for the group
 * reminder: an interval group's clock runs off the readings of all its member checks together.
 * All `checks` must belong to one household.
 */
export async function loadCheckIntervalLogs(
  db: Database,
  env: Env,
  input: {
    checks: HealthCheckRow[];
    from: string;
    to: string;
    timeZone: string;
    now: Date;
    /** The group's own interval, which may be longer than any member's. */
    lookbackMinutes?: number;
  },
): Promise<Map<string, IntervalLog[]>> {
  const result = new Map<string, IntervalLog[]>();
  if (input.checks.length === 0) return result;
  const data = await gatherSlotData(db, input);
  for (const check of input.checks) {
    result.set(check.id, intervalLogsFor(check, data, slotCheckFor(check, env)));
  }
  return result;
}
