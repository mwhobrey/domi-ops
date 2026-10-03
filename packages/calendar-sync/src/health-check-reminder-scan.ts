import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  healthCheckGroupMembers,
  healthCheckGroups,
  healthCheckReminderSent,
  healthChecks,
  households,
} from "@domi-ops/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { minuteMs, type SlotResult } from "./health-check-slots.js";
import {
  buildCheckReminderCopy,
  planCheckReminders,
  type CheckReminderKind,
} from "./health-check-reminder-plan.js";
import { claimedByGroups, sendCheckGroupReminders } from "./health-check-group-reminders.js";
import { checkReminderPushExtras } from "./health-check-push-actions.js";
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
import { addDaysIso, localDateOfInstant } from "./household-time.js";
import { deliverUserNotificationToSubscriptions, persistUserNotificationOnce } from "./user-notify.js";

export {
  OVERDUE_NUDGE_AFTER_MINUTES,
  buildCheckReminderCopy,
  planCheckReminders,
  type CheckReminderKind,
} from "./health-check-reminder-plan.js";

/**
 * Reminders for scheduled health checks ("log Ally's BP at 8, 12, 4 and 8"), WHO-386. Modelled on
 * the medication reminder scan: every 5 minutes, per recipient and per device in that device's
 * time zone, deduped per slot and offset. The difference is the point of a check: **a slot that is
 * already answered gets no reminder**. A reading logged from the Log tab at 12:10 completes the
 * 12:00 slot, so nobody is told to take it.
 */

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
      ...checkReminderPushExtras(env, {
        householdId: input.householdId,
        userId: input.recipient.userId,
        checkId: input.checkId,
        scheduledAt: input.scheduledAt,
        timeZone: input.target.timezone,
      }),
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

    // Groups bundle several checks into one reminder (WHO-387). Only live checks count as members:
    // a paused or deleted one drops out of its group's reminder.
    const groups = await db
      .select()
      .from(healthCheckGroups)
      .where(
        and(
          eq(healthCheckGroups.householdId, household.id),
          eq(healthCheckGroups.enabled, true),
          inArray(healthCheckGroups.scheduleKind, ["scheduled", "interval"]),
        ),
      );
    const checkById = new Map(checks.map((c) => [c.id, c]));
    const membersByGroup = new Map<string, (typeof checks)[number][]>();
    const groupsByCheck = new Map<string, (typeof groups)[number][]>();
    if (groups.length > 0) {
      const groupById = new Map(groups.map((g) => [g.id, g]));
      const memberships = await db
        .select({ groupId: healthCheckGroupMembers.groupId, checkId: healthCheckGroupMembers.checkId })
        .from(healthCheckGroupMembers)
        .where(inArray(healthCheckGroupMembers.groupId, groups.map((g) => g.id)));
      for (const { groupId, checkId } of memberships) {
        const check = checkById.get(checkId);
        const group = groupById.get(groupId);
        if (!check || !group) continue;
        membersByGroup.set(groupId, [...(membersByGroup.get(groupId) ?? []), check]);
        groupsByCheck.set(checkId, [...(groupsByCheck.get(checkId) ?? []), group]);
      }
    }

    const bundles = new Map<string, HealthMedReminderRecipientBundle>();
    const targetsByUser = new Map<string, DeliveryTarget[]>();
    const statusCache = new Map<string, Promise<SlotResult[]>>();

    const recipientsFor = async (memberId: string) => {
      let bundle = bundles.get(memberId);
      if (!bundle) {
        bundle = await listHealthCheckReminderRecipients(db, { householdId: household.id, subjectMemberId: memberId });
        bundles.set(memberId, bundle);
      }
      return bundle;
    };
    const targetsFor = async (recipient: HealthMedReminderRecipient) => {
      let targets = targetsByUser.get(recipient.userId);
      if (!targets) {
        targets = await targetsForRecipient(db, recipient, householdTz);
        targetsByUser.set(recipient.userId, targets);
      }
      return targets;
    };
    // Where each slot stands, in the device's time zone: yesterday .. tomorrow, so a slot just
    // after midnight can still be reminded about the evening before.
    const statusesFor = (check: (typeof checks)[number], tz: string): Promise<SlotResult[]> => {
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
      return pending;
    };

    for (const check of checks) {
      const offsets = parseReminderOffsets(check.reminderOffsetsJson);
      const checkName = decryptReminderName(check.name, env, "Health check");

      const bundle = await recipientsFor(check.memberId);
      if (bundle.recipients.length === 0) continue;

      for (const recipient of bundle.recipients) {
        for (const target of await targetsFor(recipient)) {
          const tz = target.timezone;
          // What a group takes over: its covered slots, or an interval check's whole schedule.
          const claimed = claimedByGroups(check, groupsByCheck.get(check.id) ?? [], tz, now);
          if (claimed.all) continue;

          for (const slot of await statusesFor(check, tz)) {
            if (claimed.instants.has(minuteMs(slot.scheduledAt))) continue;
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

    sent += await sendCheckGroupReminders(
      { db, env, now, householdId: household.id, recipientsFor, targetsFor, statusesFor },
      groups,
      membersByGroup,
    );
  }

  return sent;
}
