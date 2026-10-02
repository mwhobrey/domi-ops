import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthCheckReminderSent, healthChecks, households } from "@domi-ops/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { CHECK_SLOT_TOLERANCE_MINUTES, type SlotResult } from "./health-check-slots.js";
import { loadCheckSlotStatuses } from "./health-check-status.js";
import {
  listHealthCheckReminderRecipients,
  type HealthMedReminderRecipient,
  type HealthMedReminderRecipientBundle,
} from "./health-med-reminder-recipients.js";
import {
  LOOKBACK_MS,
  WINDOW_MS,
  decryptReminderName,
  householdHasHealthModule,
  parseReminderOffsets,
  reminderWhenLabel,
  targetsForRecipient,
  type DeliveryTarget,
} from "./health-reminder-shared.js";
import { addDaysIso, formatTimeLabelInTz, localDateOfInstant } from "./household-time.js";
import { deliverUserNotificationToSubscriptions, persistUserNotificationOnce } from "./user-notify.js";

/**
 * Reminders for scheduled health checks ("log Ally's BP at 8, 12, 4 and 8"), WHO-386. Modelled on
 * the medication reminder scan: every 5 minutes, per recipient and per device in that device's
 * time zone, deduped per slot and offset. The difference is the point of a check: **a slot that is
 * already answered gets no reminder**. A reading logged from the Log tab at 12:10 completes the
 * 12:00 slot, so nobody is told to take it.
 */

/**
 * A slot that is still unanswered this long after it was due gets one gentle nudge. It is the same
 * 30 minutes as the matching tolerance, i.e. the moment the slot turns `overdue`. The nudge is
 * stored in the dedupe table with a negative offset, which a person-chosen offset (always >= 0)
 * can never collide with.
 */
export const OVERDUE_NUDGE_AFTER_MINUTES = CHECK_SLOT_TOLERANCE_MINUTES;
const OVERDUE_NUDGE_OFFSET = -OVERDUE_NUDGE_AFTER_MINUTES;

export type CheckReminderKind = "upcoming" | "due" | "overdue";

/**
 * Which reminders are due for one slot right now. Pure.
 *
 * - `upcoming` / `due` slots: one reminder per configured offset (minutes before the slot) whose
 *   fire time falls inside the scan's window, so a scan that ran late still sends it.
 * - an `overdue` slot: the single nudge, if its fire time is inside the window.
 * - anything answered (`done`, `skipped`, `missed`): nothing.
 */
export function planCheckReminders(input: {
  slot: Pick<SlotResult, "scheduledAt" | "status">;
  offsets: readonly number[];
  now: Date;
}): { offsetMinutes: number; kind: CheckReminderKind }[] {
  const nowMs = input.now.getTime();
  const windowEnd = nowMs + WINDOW_MS;
  const lookbackStart = nowMs - LOOKBACK_MS;
  const slotMs = input.slot.scheduledAt.getTime();
  const inWindow = (fireAt: number) => fireAt <= windowEnd && fireAt >= lookbackStart;

  if (input.slot.status === "upcoming" || input.slot.status === "due") {
    const minutesUntil = Math.max(0, Math.round((slotMs - nowMs) / 60_000));
    const kind: CheckReminderKind = minutesUntil <= 0 ? "due" : "upcoming";
    return [...new Set(input.offsets)]
      .filter((offset) => inWindow(slotMs - offset * 60_000))
      .map((offsetMinutes) => ({ offsetMinutes, kind }));
  }

  if (input.slot.status === "overdue" && inWindow(slotMs + OVERDUE_NUDGE_AFTER_MINUTES * 60_000)) {
    return [{ offsetMinutes: OVERDUE_NUDGE_OFFSET, kind: "overdue" }];
  }
  return [];
}

export function buildCheckReminderCopy(input: {
  checkName: string;
  kind: CheckReminderKind;
  scheduledAt: Date;
  timeZone: string;
  isSubject: boolean;
  subjectLabel: string;
  now?: Date;
}): { title: string; body: string } {
  const timeLabel = formatTimeLabelInTz(input.scheduledAt, input.timeZone);
  const when = reminderWhenLabel(input.scheduledAt, input.timeZone, input.now);
  const core =
    input.kind === "overdue"
      ? `${input.checkName} at ${when} hasn't been logged yet`
      : input.kind === "due"
        ? `Time to check ${input.checkName} at ${when}`
        : `${input.checkName} at ${when}`;
  return {
    title: input.kind === "overdue" ? `Health check overdue • ${timeLabel}` : `Health check • ${timeLabel}`,
    // The notification title carries only the time; the body has the full context. A caregiver is
    // told whose check it is.
    body: input.isSubject ? core : `${input.subjectLabel} — ${core}`,
  };
}

export function buildCheckReminderDeepLink(input: { checkId: string; scheduledAt: Date }): string {
  const params = new URLSearchParams({ check: input.checkId, scheduledAt: input.scheduledAt.toISOString() });
  return `/health?${params.toString()}`;
}

async function alreadySent(
  db: Database,
  checkId: string,
  scheduledAt: Date,
  offsetMinutes: number,
  subscriptionId: string | null,
  userId: string,
): Promise<boolean> {
  const conditions = [
    eq(healthCheckReminderSent.checkId, checkId),
    eq(healthCheckReminderSent.scheduledAt, scheduledAt),
    eq(healthCheckReminderSent.offsetMinutes, offsetMinutes),
  ];
  if (subscriptionId) {
    conditions.push(eq(healthCheckReminderSent.subscriptionId, subscriptionId));
  } else {
    conditions.push(isNull(healthCheckReminderSent.subscriptionId));
    conditions.push(eq(healthCheckReminderSent.userId, userId));
  }
  const [row] = await db
    .select({ id: healthCheckReminderSent.id })
    .from(healthCheckReminderSent)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
}

async function deliverOneCheckReminder(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    checkId: string;
    checkName: string;
    scheduledAt: Date;
    offsetMinutes: number;
    kind: CheckReminderKind;
    now: Date;
    recipient: HealthMedReminderRecipient;
    subjectLabel: string;
    target: DeliveryTarget;
  },
): Promise<boolean> {
  if (
    await alreadySent(
      db,
      input.checkId,
      input.scheduledAt,
      input.offsetMinutes,
      input.target.subscriptionId,
      input.recipient.userId,
    )
  ) {
    return false;
  }

  const { title, body } = buildCheckReminderCopy({
    checkName: input.checkName,
    kind: input.kind,
    scheduledAt: input.scheduledAt,
    timeZone: input.target.timezone,
    isSubject: input.recipient.isSubject,
    subjectLabel: input.subjectLabel,
    now: input.now,
  });
  const url = buildCheckReminderDeepLink({ checkId: input.checkId, scheduledAt: input.scheduledAt });
  // One tag per slot and offset, not per device: the inbox keeps a single row however many of a
  // person's devices are reminded, and a device replaces its own earlier notification.
  const tag = `health-check-${input.checkId}-${input.scheduledAt.toISOString().slice(0, 16)}-${input.offsetMinutes}`;

  if (input.target.push) {
    await deliverUserNotificationToSubscriptions(db, env, {
      userId: input.recipient.userId,
      householdId: input.householdId,
      title,
      body,
      url,
      tag,
      subscriptions: [{ ...input.target.push, userId: input.recipient.userId }],
    });
  } else {
    await persistUserNotificationOnce(db, {
      userId: input.recipient.userId,
      householdId: input.householdId,
      title,
      body,
      url,
      tag,
    });
  }

  // The unique indexes are the backstop if two scans ever overlap.
  await db
    .insert(healthCheckReminderSent)
    .values({
      checkId: input.checkId,
      scheduledAt: input.scheduledAt,
      offsetMinutes: input.offsetMinutes,
      subscriptionId: input.target.subscriptionId,
      userId: input.recipient.userId,
    })
    .onConflictDoNothing();
  return true;
}

/**
 * Send the reminders that are due. Returns how many were delivered. Runs under the worker-scan
 * database context (cross-tenant), and the worker passes no options.
 *
 * - `now`: the clock, for tests.
 * - `householdId`: only scan this household. Tests use it so that other suites sharing the
 *   database (and deleting their own households while a scan is mid-sweep) cannot interfere.
 */
export async function scanHealthCheckReminders(
  db: Database,
  env: Env,
  opts: { now?: Date; householdId?: string } = {},
): Promise<number> {
  const now = opts.now ?? new Date();

  const householdRows = await db
    .select({ id: households.id, modulesEnabled: households.modulesEnabled, timezone: households.timezone })
    .from(households)
    .where(opts.householdId ? eq(households.id, opts.householdId) : undefined);
  const enabled = householdRows.filter((h) => householdHasHealthModule(h.modulesEnabled));
  if (enabled.length === 0) return 0;

  let sent = 0;

  for (const household of enabled) {
    const householdTz = household.timezone ?? "UTC";

    // Paused (disabled) and deleted checks never remind. Slots inside a pause or outside the
    // start / end dates are dropped by the slot logic as well.
    const checks = await db
      .select()
      .from(healthChecks)
      .where(
        and(
          eq(healthChecks.householdId, household.id),
          eq(healthChecks.enabled, true),
          isNull(healthChecks.deletedAt),
          inArray(healthChecks.scheduleKind, ["scheduled", "interval"]),
        ),
      );
    if (checks.length === 0) continue;

    const bundles = new Map<string, HealthMedReminderRecipientBundle>();
    const targetsByUser = new Map<string, DeliveryTarget[]>();
    const statusCache = new Map<string, Promise<SlotResult[]>>();

    for (const check of checks) {
      const offsets = parseReminderOffsets(check.reminderOffsetsJson);
      const checkName = decryptReminderName(check.name, env, "Health check");

      let bundle = bundles.get(check.memberId);
      if (!bundle) {
        bundle = await listHealthCheckReminderRecipients(db, {
          householdId: household.id,
          subjectMemberId: check.memberId,
        });
        bundles.set(check.memberId, bundle);
      }
      if (bundle.recipients.length === 0) continue;

      for (const recipient of bundle.recipients) {
        let targets = targetsByUser.get(recipient.userId);
        if (!targets) {
          targets = await targetsForRecipient(db, recipient, householdTz);
          targetsByUser.set(recipient.userId, targets);
        }

        for (const target of targets) {
          const tz = target.timezone;
          // Where each slot stands, in this device's time zone: yesterday .. tomorrow, so a slot
          // just after midnight can still be reminded about the evening before.
          const cacheKey = `${check.id}|${tz}`;
          let pending = statusCache.get(cacheKey);
          if (!pending) {
            const today = localDateOfInstant(now, tz);
            pending = loadCheckSlotStatuses(db, env, {
              checks: [check],
              from: addDaysIso(today, -1),
              to: addDaysIso(today, 1),
              timeZone: tz,
              now,
              includeAwaitingFirst: false,
            }).then((m) => m.get(check.id) ?? []);
            statusCache.set(cacheKey, pending);
          }

          for (const slot of await pending) {
            for (const { offsetMinutes, kind } of planCheckReminders({ slot, offsets, now })) {
              if (
                await deliverOneCheckReminder(db, env, {
                  householdId: household.id,
                  checkId: check.id,
                  checkName,
                  scheduledAt: slot.scheduledAt,
                  offsetMinutes,
                  kind,
                  now,
                  recipient,
                  subjectLabel: bundle.subjectLabel,
                  target,
                })
              ) {
                sent += 1;
              }
            }
          }
        }
      }
    }
  }

  return sent;
}
