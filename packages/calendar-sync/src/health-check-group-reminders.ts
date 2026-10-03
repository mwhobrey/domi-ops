import type { Env } from "@domi-ops/config";
import type { Database, healthCheckGroups, healthChecks } from "@domi-ops/db";
import { healthCheckGroupReminderSent } from "@domi-ops/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  buildCheckReminderCopy,
  planCheckReminders,
  type CheckReminderKind,
} from "./health-check-reminder-plan.js";
import { clockSlotStatus, minuteMs, type SlotResult } from "./health-check-slots.js";
import { loadCheckIntervalLogs } from "./health-check-status.js";
import type { HealthMedReminderRecipient, HealthMedReminderRecipientBundle } from "./health-med-reminder-recipients.js";
import {
  decryptReminderName,
  parseReminderOffsets,
  type DeliveryTarget,
} from "./health-reminder-shared.js";
import { expandScheduledSlots, parseFixedTimeSchedule } from "./health-schedule.js";
import { addDaysIso, formatTimeLabelInTz, localDateOfInstant } from "./household-time.js";
import { nextIntervalPending, parseIntervalSchedule } from "./med-interval-schedule.js";
import { deliverUserNotificationToSubscriptions, persistUserNotificationOnce } from "./user-notify.js";

/**
 * Consolidated reminders for check groups (WHO-387): "Morning: blood pressure, weight, pain" as one
 * notification instead of three. Mirrors medication groups (see the doc comment on
 * `healthMedicationGroups`), with the one difference that a check slot can be answered, so a group
 * only reminds about the members still waiting.
 *
 * - A scheduled group has its own times. At a group time, the members that have a slot at exactly
 *   that instant are covered; a member merely belonging to the group does not mean all of its times
 *   are.
 * - A member's own reminder for a slot the group covers is not sent (the group's is). That is
 *   decided per instant, so a group that skips a weekday does not swallow the member's reminder on it.
 * - An interval group runs one clock off the readings of all its members together, and its interval
 *   members delegate their whole schedule to it.
 * - The group stays quiet when every covered member is already answered. If only some are, it
 *   reminds about the rest.
 * - Paused or deleted members drop out of the group's reminder and its clock.
 */

type CheckRow = typeof healthChecks.$inferSelect;
type GroupRow = typeof healthCheckGroups.$inferSelect;

/** The three local days around `now`, the same span the per-check reminders look at. */
function daysAround(now: Date, tz: string): string[] {
  const today = localDateOfInstant(now, tz);
  return [addDaysIso(today, -1), today, addDaysIso(today, 1)];
}

/** Instants (minute precision) at which a scheduled group has a reminder, around `now` in `tz`. */
function scheduledGroupInstants(group: GroupRow, tz: string, now: Date): Date[] {
  if (group.scheduleKind !== "scheduled") return [];
  const schedule = parseFixedTimeSchedule(group.scheduleJson);
  return expandScheduledSlots({
    times: schedule.times,
    daysOfWeek: schedule.daysOfWeek,
    startDate: group.startDate,
    endDate: group.endDate,
    dates: daysAround(now, tz),
    timeZone: tz,
  }).map((s) => s.scheduledAt);
}

/**
 * What the groups a check belongs to take over from its own reminders, as seen from a device in
 * `tz`: everything (an interval check in an interval group), or particular slot instants (a
 * scheduled check at the group's times).
 */
export function claimedByGroups(
  check: CheckRow,
  groups: readonly GroupRow[],
  tz: string,
  now: Date,
): { all: boolean; instants: Set<number> } {
  if (check.scheduleKind === "interval") {
    // Only a group that can actually remind takes the schedule over; an unreadable one must not
    // leave its members with no reminders at all.
    // ... and only on days the group is running, otherwise nobody would remind on the others.
    const today = localDateOfInstant(now, tz);
    const delegated = groups.some(
      (g) =>
        g.scheduleKind === "interval" &&
        parseIntervalSchedule(g.scheduleJson) &&
        !(g.startDate && today < g.startDate) &&
        !(g.endDate && today > g.endDate),
    );
    return { all: delegated, instants: new Set() };
  }
  const instants = new Set<number>();
  for (const group of groups) {
    for (const at of scheduledGroupInstants(group, tz, now)) instants.add(minuteMs(at));
  }
  return { all: false, instants };
}

export function buildCheckGroupReminderCopy(input: {
  groupName: string;
  checkNames: string[];
  kind: CheckReminderKind;
  scheduledAt: Date;
  timeZone: string;
  isSubject: boolean;
  subjectLabel: string;
  now?: Date;
}): { title: string; body: string } {
  const timeLabel = formatTimeLabelInTz(input.scheduledAt, input.timeZone);
  const what = `${input.groupName}: ${input.checkNames.join(", ")}`;
  // Same wording as a single check, with "Morning: blood pressure, weight" in place of its name.
  const { body } = buildCheckReminderCopy({
    checkName: what,
    kind: input.kind,
    scheduledAt: input.scheduledAt,
    timeZone: input.timeZone,
    isSubject: input.isSubject,
    subjectLabel: input.subjectLabel,
    now: input.now,
  });
  return {
    title: input.kind === "overdue" ? `${input.groupName} overdue • ${timeLabel}` : `${input.groupName} • ${timeLabel}`,
    body,
  };
}

export function buildCheckGroupReminderDeepLink(input: { groupId: string; scheduledAt: Date }): string {
  const params = new URLSearchParams({ checkGroup: input.groupId, scheduledAt: input.scheduledAt.toISOString() });
  return `/health?${params.toString()}`;
}

async function alreadySentGroup(
  db: Database,
  groupId: string,
  scheduledAt: Date,
  offsetMinutes: number,
  subscriptionId: string | null,
  userId: string,
): Promise<boolean> {
  const conditions = [
    eq(healthCheckGroupReminderSent.groupId, groupId),
    eq(healthCheckGroupReminderSent.scheduledAt, scheduledAt),
    eq(healthCheckGroupReminderSent.offsetMinutes, offsetMinutes),
  ];
  if (subscriptionId) {
    conditions.push(eq(healthCheckGroupReminderSent.subscriptionId, subscriptionId));
  } else {
    conditions.push(isNull(healthCheckGroupReminderSent.subscriptionId));
    conditions.push(eq(healthCheckGroupReminderSent.userId, userId));
  }
  const [row] = await db
    .select({ id: healthCheckGroupReminderSent.id })
    .from(healthCheckGroupReminderSent)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
}

async function deliverOneGroupReminder(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    groupId: string;
    groupName: string;
    checkNames: string[];
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
    await alreadySentGroup(
      db,
      input.groupId,
      input.scheduledAt,
      input.offsetMinutes,
      input.target.subscriptionId,
      input.recipient.userId,
    )
  ) {
    return false;
  }

  const { title, body } = buildCheckGroupReminderCopy({
    groupName: input.groupName,
    checkNames: input.checkNames,
    kind: input.kind,
    scheduledAt: input.scheduledAt,
    timeZone: input.target.timezone,
    isSubject: input.recipient.isSubject,
    subjectLabel: input.subjectLabel,
    now: input.now,
  });
  const url = buildCheckGroupReminderDeepLink({ groupId: input.groupId, scheduledAt: input.scheduledAt });
  const tag = `health-check-group-${input.groupId}-${input.scheduledAt.toISOString().slice(0, 16)}-${input.offsetMinutes}`;

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

  await db
    .insert(healthCheckGroupReminderSent)
    .values({
      groupId: input.groupId,
      scheduledAt: input.scheduledAt,
      offsetMinutes: input.offsetMinutes,
      subscriptionId: input.target.subscriptionId,
      userId: input.recipient.userId,
    })
    .onConflictDoNothing();
  return true;
}

/** What the scan hands the group pass so it shares the per-check caches. */
export type GroupReminderContext = {
  db: Database;
  env: Env;
  now: Date;
  householdId: string;
  /** Recipients of a person's checks (cached by the scan). */
  recipientsFor(memberId: string): Promise<HealthMedReminderRecipientBundle>;
  /** Delivery targets of a recipient (cached by the scan). */
  targetsFor(recipient: HealthMedReminderRecipient): Promise<DeliveryTarget[]>;
  /** Slot statuses of a check as seen from a device in `tz` (cached by the scan). */
  statusesFor(check: CheckRow, tz: string): Promise<SlotResult[]>;
};

/**
 * Send the group reminders that are due. `membersByGroup` holds only live members (enabled, not
 * deleted); a group with none sends nothing. Returns how many were delivered.
 */
export async function sendCheckGroupReminders(
  ctx: GroupReminderContext,
  groups: readonly GroupRow[],
  membersByGroup: ReadonlyMap<string, CheckRow[]>,
): Promise<number> {
  const { db, env, now } = ctx;
  let sent = 0;

  for (const group of groups) {
    const members = membersByGroup.get(group.id) ?? [];
    if (members.length === 0) continue;

    const bundle = await ctx.recipientsFor(group.memberId);
    if (bundle.recipients.length === 0) continue;

    const offsets = parseReminderOffsets(group.reminderOffsetsJson);
    const groupName = decryptReminderName(group.name, env, "Health check");
    const nameOf = (c: CheckRow) => decryptReminderName(c.name, env, "Health check");
    // The database returns members in no particular order; read the same list every time.
    const namesOf = (checks: readonly CheckRow[]) =>
      checks.map(nameOf).sort((a, b) => a.localeCompare(b));

    for (const recipient of bundle.recipients) {
      for (const target of await ctx.targetsFor(recipient)) {
        const tz = target.timezone;

        const deliver = async (scheduledAt: Date, status: SlotResult["status"], checkNames: string[]) => {
          for (const { offsetMinutes, kind } of planCheckReminders({
            slot: { scheduledAt, status },
            offsets,
            now,
          })) {
            if (
              await deliverOneGroupReminder(db, env, {
                householdId: ctx.householdId,
                groupId: group.id,
                groupName,
                checkNames,
                scheduledAt,
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
        };

        if (group.scheduleKind === "interval") {
          const interval = parseIntervalSchedule(group.scheduleJson);
          if (!interval) continue;
          const today = localDateOfInstant(now, tz);
          if (group.startDate && today < group.startDate) continue;
          if (group.endDate && today > group.endDate) continue;

          // One clock for the whole group: whichever member was read most recently resets it.
          const logsByCheck = await loadCheckIntervalLogs(db, env, {
            checks: members,
            from: addDaysIso(today, -1),
            to: addDaysIso(today, 1),
            timeZone: tz,
            now,
            // "Every N days" counts from a reading that may be older than the days looked at.
            lookbackMinutes: interval.everyMinutes,
          });
          const pending = nextIntervalPending({
            schedule: interval,
            tz,
            date: today,
            now,
            logs: [...logsByCheck.values()].flat(),
          });
          // "Start" (a schedule that begins at the first reading) has no instant to remind about.
          if (!pending || pending.awaitingFirst) continue;
          await deliver(pending.scheduledAt, clockSlotStatus(pending.scheduledAt, now), namesOf(members));
          continue;
        }

        const scheduledMembers = members.filter((m) => m.scheduleKind === "scheduled");
        if (scheduledMembers.length === 0) continue;
        const statuses = new Map<string, SlotResult[]>();
        for (const m of scheduledMembers) statuses.set(m.id, await ctx.statusesFor(m, tz));

        for (const at of scheduledGroupInstants(group, tz, now)) {
          // The members with a slot at exactly this instant that is still waiting for an answer.
          const waiting = scheduledMembers.flatMap((m) => {
            const slot = statuses.get(m.id)!.find((s) => minuteMs(s.scheduledAt) === minuteMs(at));
            return slot && (slot.status === "upcoming" || slot.status === "due" || slot.status === "overdue")
              ? [{ check: m, status: slot.status }]
              : [];
          });
          if (waiting.length === 0) continue;
          await deliver(at, waiting[0]!.status, namesOf(waiting.map((w) => w.check)));
        }
      }
    }
  }
  return sent;
}
