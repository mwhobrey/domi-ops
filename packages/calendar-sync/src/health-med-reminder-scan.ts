import type { Env } from "@domi-ops/config";
import {
  healthMedPushActionSecret,
  mintHealthMedGroupPushActionToken,
  mintHealthMedPushActionToken,
} from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthMedGroupReminderSent,
  healthMedReminderSent,
  healthMedicationGroupMembers,
  healthMedicationGroups,
  healthMedicationLogs,
  healthMedications,
  households,
} from "@domi-ops/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  listHealthMedReminderRecipients,
  type HealthMedReminderRecipient,
} from "./health-med-reminder-recipients.js";
import {
  addDaysIso,
  formatTimeLabelInTz,
  todayIsoDateInTz,
} from "./household-time.js";
import { expandScheduledSlots, parseFixedTimeSchedule } from "./health-schedule.js";
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
import { nextIntervalPending, parseIntervalSchedule } from "./med-interval-schedule.js";
import {
  deliverUserNotificationToSubscriptions,
  persistUserNotificationOnce,
} from "./user-notify.js";

const MED_PUSH_ACTIONS = [
  { action: "taken", title: "Taken" },
  { action: "skip", title: "Skip" },
] as const;

function buildMedReminderDeepLink(input: {
  medicationId: string;
  scheduledAt: Date;
  token: string | null;
}): string {
  const params = new URLSearchParams({ medication: input.medicationId });
  if (input.token) {
    params.set("action", "taken");
    params.set("scheduledAt", input.scheduledAt.toISOString());
    params.set("token", input.token);
  }
  return `/health?${params.toString()}`;
}

function mintMedActionToken(
  env: Env,
  input: {
    householdId: string;
    userId: string;
    medicationId: string;
    scheduledAt: Date;
  },
): string | null {
  const secret = healthMedPushActionSecret(env);
  if (!secret) return null;
  try {
    return mintHealthMedPushActionToken(
      {
        householdId: input.householdId,
        userId: input.userId,
        medicationId: input.medicationId,
        scheduledAt: input.scheduledAt.toISOString(),
      },
      secret,
    );
  } catch {
    return null;
  }
}

function datesAround(tz: string): string[] {
  const today = todayIsoDateInTz(tz);
  return [addDaysIso(today, -1), today, addDaysIso(today, 1)];
}

function medReminderBody(input: {
  medName: string;
  minutesUntil: number;
  scheduledAt: Date;
  timeZone: string;
  isSubject: boolean;
  subjectLabel: string;
  now?: Date;
}): string {
  const whenLabel = reminderWhenLabel(input.scheduledAt, input.timeZone, input.now);

  const core =
    input.minutesUntil <= 0 ? `Time to take ${input.medName} at ${whenLabel}` : `${input.medName} at ${whenLabel}`;

  // OS notification title has only the time; body has full “take at” context.
  // (keeps iOS readable while still being explicit about the scheduled slot)
  if (input.isSubject) return core;
  return `${input.subjectLabel} — ${core}`;
}

export function buildMedReminderCopy(input: {
  medName: string;
  minutesUntil: number;
  scheduledAt: Date;
  timeZone: string;
  isSubject: boolean;
  subjectLabel: string;
  now?: Date;
}): { title: string; body: string } {
  const timeLabel = formatTimeLabelInTz(input.scheduledAt, input.timeZone);
  return {
    title: `Medication reminder • ${timeLabel}`,
    body: medReminderBody({
      medName: input.medName,
      minutesUntil: input.minutesUntil,
      scheduledAt: input.scheduledAt,
      timeZone: input.timeZone,
      isSubject: input.isSubject,
      subjectLabel: input.subjectLabel,
      now: input.now,
    }),
  };
}

function buildMedGroupReminderDeepLink(input: {
  medicationGroupId: string;
  scheduledAt: Date;
  token: string | null;
}): string {
  const params = new URLSearchParams({ medicationGroup: input.medicationGroupId });
  if (input.token) {
    params.set("action", "taken");
    params.set("scheduledAt", input.scheduledAt.toISOString());
    params.set("token", input.token);
  }
  return `/health?${params.toString()}`;
}

function mintMedGroupActionToken(
  env: Env,
  input: {
    householdId: string;
    userId: string;
    medicationGroupId: string;
    scheduledAt: Date;
  },
): string | null {
  const secret = healthMedPushActionSecret(env);
  if (!secret) return null;
  try {
    return mintHealthMedGroupPushActionToken(
      {
        householdId: input.householdId,
        userId: input.userId,
        medicationGroupId: input.medicationGroupId,
        scheduledAt: input.scheduledAt.toISOString(),
      },
      secret,
    );
  } catch {
    return null;
  }
}

/** Enumerates member medication names up to a limit, then "+N more" — readable for the common
 *  2-3 med case (the actual notification-fatigue pain point), capped so a large group doesn't
 *  produce an unreadable lock-screen body. */
function medGroupReminderBody(input: {
  medNames: string[];
  minutesUntil: number;
  scheduledAt: Date;
  timeZone: string;
  isSubject: boolean;
  subjectLabel: string;
  now?: Date;
}): string {
  const MAX_NAMED = 3;
  const shown = input.medNames.slice(0, MAX_NAMED);
  const extra = input.medNames.length - shown.length;
  const list = extra > 0 ? `${shown.join(", ")} + ${extra} more` : shown.join(", ");
  const whenLabel = reminderWhenLabel(input.scheduledAt, input.timeZone, input.now);

  const core =
    input.minutesUntil <= 0 ? `Time to take ${list} at ${whenLabel}` : `${list} at ${whenLabel}`;
  if (input.isSubject) return core;
  return `${input.subjectLabel} — ${core}`;
}

/** Group variant of buildMedReminderCopy — the group's own name (e.g. "Morning meds") replaces
 *  the generic "Medication reminder" title, since the group name *is* the user-chosen label. */
export function buildMedGroupReminderCopy(input: {
  groupName: string;
  medNames: string[];
  minutesUntil: number;
  scheduledAt: Date;
  timeZone: string;
  isSubject: boolean;
  subjectLabel: string;
  now?: Date;
}): { title: string; body: string } {
  const timeLabel = formatTimeLabelInTz(input.scheduledAt, input.timeZone);
  return {
    title: `${input.groupName} • ${timeLabel}`,
    body: medGroupReminderBody({
      medNames: input.medNames,
      minutesUntil: input.minutesUntil,
      scheduledAt: input.scheduledAt,
      timeZone: input.timeZone,
      isSubject: input.isSubject,
      subjectLabel: input.subjectLabel,
      now: input.now,
    }),
  };
}

async function alreadySent(
  db: Database,
  medicationId: string,
  scheduledAt: Date,
  offsetMinutes: number,
  subscriptionId: string | null,
  userId: string,
): Promise<boolean> {
  const conditions = [
    eq(healthMedReminderSent.medicationId, medicationId),
    eq(healthMedReminderSent.scheduledAt, scheduledAt),
    eq(healthMedReminderSent.offsetMinutes, offsetMinutes),
  ];
  if (subscriptionId) {
    conditions.push(eq(healthMedReminderSent.subscriptionId, subscriptionId));
  } else {
    conditions.push(isNull(healthMedReminderSent.subscriptionId));
    conditions.push(eq(healthMedReminderSent.userId, userId));
  }
  const [row] = await db
    .select({ id: healthMedReminderSent.id })
    .from(healthMedReminderSent)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
}

async function deliverOneMedReminder(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    medicationId: string;
    medName: string;
    scheduledAt: Date;
    offsetMinutes: number;
    tag: string;
    now: Date;
    recipient: HealthMedReminderRecipient;
    subjectLabel: string;
    target: DeliveryTarget;
  },
): Promise<boolean> {
  if (
    await alreadySent(
      db,
      input.medicationId,
      input.scheduledAt,
      input.offsetMinutes,
      input.target.subscriptionId,
      input.recipient.userId,
    )
  ) {
    return false;
  }

  const minutesUntil = Math.max(
    0,
    Math.round((input.scheduledAt.getTime() - input.now.getTime()) / 60000),
  );
  const { title, body } = buildMedReminderCopy({
    medName: input.medName,
    minutesUntil,
    scheduledAt: input.scheduledAt,
    timeZone: input.target.timezone,
    isSubject: input.recipient.isSubject,
    subjectLabel: input.subjectLabel,
  });
  const token = mintMedActionToken(env, {
    householdId: input.householdId,
    userId: input.recipient.userId,
    medicationId: input.medicationId,
    scheduledAt: input.scheduledAt,
  });
  const url = buildMedReminderDeepLink({
    medicationId: input.medicationId,
    scheduledAt: input.scheduledAt,
    token,
  });

  if (input.target.push) {
    await deliverUserNotificationToSubscriptions(db, env, {
      userId: input.recipient.userId,
      householdId: input.householdId,
      title,
      body,
      url,
      tag: input.tag,
      subscriptions: [{ ...input.target.push, userId: input.recipient.userId }],
      ...(token
        ? {
            actions: [...MED_PUSH_ACTIONS],
            data: {
              medicationId: input.medicationId,
              scheduledAt: input.scheduledAt.toISOString(),
              token,
            },
          }
        : {}),
    });
  } else {
    await persistUserNotificationOnce(db, {
      userId: input.recipient.userId,
      householdId: input.householdId,
      title,
      body,
      url,
      tag: input.tag,
    });
  }

  await db.insert(healthMedReminderSent).values({
    medicationId: input.medicationId,
    scheduledAt: input.scheduledAt,
    offsetMinutes: input.offsetMinutes,
    subscriptionId: input.target.subscriptionId,
    userId: input.recipient.userId,
  });
  return true;
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
    eq(healthMedGroupReminderSent.groupId, groupId),
    eq(healthMedGroupReminderSent.scheduledAt, scheduledAt),
    eq(healthMedGroupReminderSent.offsetMinutes, offsetMinutes),
  ];
  if (subscriptionId) {
    conditions.push(eq(healthMedGroupReminderSent.subscriptionId, subscriptionId));
  } else {
    conditions.push(isNull(healthMedGroupReminderSent.subscriptionId));
    conditions.push(eq(healthMedGroupReminderSent.userId, userId));
  }
  const [row] = await db
    .select({ id: healthMedGroupReminderSent.id })
    .from(healthMedGroupReminderSent)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
}

async function deliverOneMedGroupReminder(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    groupId: string;
    groupName: string;
    medNames: string[];
    scheduledAt: Date;
    offsetMinutes: number;
    tag: string;
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

  const minutesUntil = Math.max(
    0,
    Math.round((input.scheduledAt.getTime() - input.now.getTime()) / 60000),
  );
  const { title, body } = buildMedGroupReminderCopy({
    groupName: input.groupName,
    medNames: input.medNames,
    minutesUntil,
    scheduledAt: input.scheduledAt,
    timeZone: input.target.timezone,
    isSubject: input.recipient.isSubject,
    subjectLabel: input.subjectLabel,
  });
  const token = mintMedGroupActionToken(env, {
    householdId: input.householdId,
    userId: input.recipient.userId,
    medicationGroupId: input.groupId,
    scheduledAt: input.scheduledAt,
  });
  const url = buildMedGroupReminderDeepLink({
    medicationGroupId: input.groupId,
    scheduledAt: input.scheduledAt,
    token,
  });

  if (input.target.push) {
    await deliverUserNotificationToSubscriptions(db, env, {
      userId: input.recipient.userId,
      householdId: input.householdId,
      title,
      body,
      url,
      tag: input.tag,
      subscriptions: [{ ...input.target.push, userId: input.recipient.userId }],
      ...(token
        ? {
            actions: [...MED_PUSH_ACTIONS],
            data: {
              medicationGroupId: input.groupId,
              scheduledAt: input.scheduledAt.toISOString(),
              token,
            },
          }
        : {}),
    });
  } else {
    await persistUserNotificationOnce(db, {
      userId: input.recipient.userId,
      householdId: input.householdId,
      title,
      body,
      url,
      tag: input.tag,
    });
  }

  await db.insert(healthMedGroupReminderSent).values({
    groupId: input.groupId,
    scheduledAt: input.scheduledAt,
    offsetMinutes: input.offsetMinutes,
    subscriptionId: input.target.subscriptionId,
    userId: input.recipient.userId,
  });
  return true;
}

/** `householdId` limits the scan to one household (the per-household job; see health-reminder-fanout.ts). */
export async function scanHealthMedReminders(
  db: Database,
  env: Env,
  opts: { householdId?: string } = {},
): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_MS);
  const lookbackStart = new Date(now.getTime() - LOOKBACK_MS);

  const householdRows = await db
    .select({
      id: households.id,
      modulesEnabled: households.modulesEnabled,
      timezone: households.timezone,
    })
    .from(households)
    .where(opts.householdId ? eq(households.id, opts.householdId) : undefined);

  const enabled = householdRows.filter((h) => householdHasHealthModule(h.modulesEnabled));
  if (enabled.length === 0) return 0;

  let sent = 0;

  for (const household of enabled) {
    const householdTz = household.timezone ?? "UTC";

    // Groups are many-to-many with medications — a med taken multiple times a day can have
    // different doses claimed by different groups. Loaded before the meds loop below since a
    // medication's own reminder needs to know, per dose-time, whether some group already
    // covers it. See the doc comment on healthMedicationGroups (packages/db/src/schema/health.ts)
    // for the exact claiming rule.
    const groups = await db
      .select()
      .from(healthMedicationGroups)
      .where(
        and(
          eq(healthMedicationGroups.householdId, household.id),
          eq(healthMedicationGroups.enabled, true),
          inArray(healthMedicationGroups.scheduleKind, ["scheduled", "interval"]),
        ),
      );
    const groupById = new Map(groups.map((g) => [g.id, g]));

    const meds = await db
      .select()
      .from(healthMedications)
      .where(
        and(
          eq(healthMedications.householdId, household.id),
          eq(healthMedications.enabled, true),
          inArray(healthMedications.scheduleKind, ["scheduled", "interval"]),
        ),
      );

    const medGroupMembershipMap = new Map<string, string[]>();
    if (meds.length > 0) {
      const membershipRows = await db
        .select({
          medicationId: healthMedicationGroupMembers.medicationId,
          groupId: healthMedicationGroupMembers.groupId,
        })
        .from(healthMedicationGroupMembers)
        .where(inArray(healthMedicationGroupMembers.medicationId, meds.map((m) => m.id)));
      for (const row of membershipRows) {
        const list = medGroupMembershipMap.get(row.medicationId) ?? [];
        list.push(row.groupId);
        medGroupMembershipMap.set(row.medicationId, list);
      }
    }

    function scheduledTimesClaimedByGroups(medId: string): Set<string> {
      const claimed = new Set<string>();
      for (const groupId of medGroupMembershipMap.get(medId) ?? []) {
        const group = groupById.get(groupId);
        if (!group || group.scheduleKind !== "scheduled") continue;
        for (const t of (parseFixedTimeSchedule(group.scheduleJson).times ?? [])) {
          claimed.add(t.slice(0, 5));
        }
      }
      return claimed;
    }

    function isDelegatedToIntervalGroup(medId: string): boolean {
      return (medGroupMembershipMap.get(medId) ?? []).some(
        (groupId) => groupById.get(groupId)?.scheduleKind === "interval",
      );
    }

    for (const med of meds) {
      if (med.scheduleKind === "interval" && isDelegatedToIntervalGroup(med.id)) continue;
      const offsets = parseReminderOffsets(med.reminderOffsetsJson);
      const medName = decryptReminderName(med.name, env, "Medication");

      const { recipients, subjectLabel } = await listHealthMedReminderRecipients(db, {
        householdId: household.id,
        subjectMemberId: med.memberId,
      });
      if (recipients.length === 0) continue;

      for (const recipient of recipients) {
        const targets = await targetsForRecipient(db, recipient, householdTz);

        for (const target of targets) {
          const tz = target.timezone;

          if (med.scheduleKind === "interval") {
            const interval = parseIntervalSchedule(med.scheduleJson);
            if (!interval) continue;
            if (med.startDate && todayIsoDateInTz(tz) < med.startDate) continue;
            if (med.endDate && todayIsoDateInTz(tz) > med.endDate) continue;

            const logRows = await db
              .select({
                scheduledAt: healthMedicationLogs.scheduledAt,
                loggedAt: healthMedicationLogs.loggedAt,
                status: healthMedicationLogs.status,
              })
              .from(healthMedicationLogs)
              .where(eq(healthMedicationLogs.medicationId, med.id));

            const date = todayIsoDateInTz(tz);
            const pending = nextIntervalPending({
              schedule: interval,
              tz,
              date,
              now,
              logs: logRows.map((l) => ({
                scheduledAt: l.scheduledAt,
                loggedAt: l.loggedAt,
                status: l.status,
              })),
            });
            if (!pending || pending.awaitingFirst) continue;

            for (const offsetMinutes of offsets) {
              const fireAt = new Date(pending.scheduledAt.getTime() - offsetMinutes * 60 * 1000);
              if (fireAt > windowEnd) continue;
              if (fireAt < lookbackStart) continue;

              const tag = `health-med-${med.id}-${date}-${pending.scheduledTime}-${offsetMinutes}`;
              if (
                await deliverOneMedReminder(db, env, {
                  householdId: household.id,
                  medicationId: med.id,
                  medName,
                  scheduledAt: pending.scheduledAt,
                  offsetMinutes,
                  tag,
                  now,
                  recipient,
                  subjectLabel,
                  target,
                })
              ) {
                sent += 1;
              }
            }
            continue;
          }

          const schedule = parseFixedTimeSchedule(med.scheduleJson);
          const times = schedule.times ?? [];
          if (times.length === 0) continue;
          const claimedTimes = scheduledTimesClaimedByGroups(med.id);

          for (const { date, hhmm, scheduledAt } of expandScheduledSlots({
            times,
            daysOfWeek: schedule.daysOfWeek,
            startDate: med.startDate,
            endDate: med.endDate,
            dates: datesAround(tz),
            timeZone: tz,
            skipHhmm: claimedTimes, // those doses belong to a group instead
          })) {
            for (const offsetMinutes of offsets) {
              const fireAt = new Date(scheduledAt.getTime() - offsetMinutes * 60 * 1000);
              if (fireAt > windowEnd) continue;
              if (fireAt < lookbackStart) continue;

              const [logged] = await db
                .select({ id: healthMedicationLogs.id })
                .from(healthMedicationLogs)
                .where(
                  and(
                    eq(healthMedicationLogs.medicationId, med.id),
                    eq(healthMedicationLogs.scheduledAt, scheduledAt),
                  ),
                )
                .limit(1);
              if (logged) continue;

              const tag = `health-med-${med.id}-${date}-${hhmm}-${offsetMinutes}`;
              if (
                await deliverOneMedReminder(db, env, {
                  householdId: household.id,
                  medicationId: med.id,
                  medName,
                  scheduledAt,
                  offsetMinutes,
                  tag,
                  now,
                  recipient,
                  subjectLabel,
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

    for (const group of groups) {
      const groupMembershipRows = await db
        .select({ medicationId: healthMedicationGroupMembers.medicationId })
        .from(healthMedicationGroupMembers)
        .where(eq(healthMedicationGroupMembers.groupId, group.id));
      const memberIds = groupMembershipRows.map((r) => r.medicationId);
      const memberMeds =
        memberIds.length > 0
          ? await db
              .select()
              .from(healthMedications)
              .where(
                and(
                  inArray(healthMedications.id, memberIds),
                  eq(healthMedications.householdId, household.id),
                  // Paused members stay in the group but drop out of its reminder.
                  eq(healthMedications.enabled, true),
                ),
              )
          : [];
      if (memberMeds.length === 0) continue;
      const memberMedIds = memberMeds.map((m) => m.id);
      const medNames = memberMeds.map((m) => decryptReminderName(m.name, env, "Medication"));

      const offsets = parseReminderOffsets(group.reminderOffsetsJson);
      const groupName = decryptReminderName(group.name, env, "Medication");

      const { recipients, subjectLabel } = await listHealthMedReminderRecipients(db, {
        householdId: household.id,
        subjectMemberId: group.memberId,
      });
      if (recipients.length === 0) continue;

      for (const recipient of recipients) {
        const targets = await targetsForRecipient(db, recipient, householdTz);

        for (const target of targets) {
          const tz = target.timezone;

          if (group.scheduleKind === "interval") {
            const interval = parseIntervalSchedule(group.scheduleJson);
            if (!interval) continue;
            if (group.startDate && todayIsoDateInTz(tz) < group.startDate) continue;
            if (group.endDate && todayIsoDateInTz(tz) > group.endDate) continue;

            // Group interval clock = union of all member medications' log history — once
            // grouped, the group's own schedule (not any individual member's) is authoritative,
            // so "last taken" resets on whichever member dose was logged most recently.
            const logRows = await db
              .select({
                scheduledAt: healthMedicationLogs.scheduledAt,
                loggedAt: healthMedicationLogs.loggedAt,
                status: healthMedicationLogs.status,
              })
              .from(healthMedicationLogs)
              .where(inArray(healthMedicationLogs.medicationId, memberMedIds));

            const date = todayIsoDateInTz(tz);
            const pending = nextIntervalPending({
              schedule: interval,
              tz,
              date,
              now,
              logs: logRows.map((l) => ({
                scheduledAt: l.scheduledAt,
                loggedAt: l.loggedAt,
                status: l.status,
              })),
            });
            if (!pending || pending.awaitingFirst) continue;

            for (const offsetMinutes of offsets) {
              const fireAt = new Date(pending.scheduledAt.getTime() - offsetMinutes * 60 * 1000);
              if (fireAt > windowEnd) continue;
              if (fireAt < lookbackStart) continue;

              const tag = `health-medgroup-${group.id}-${date}-${pending.scheduledTime}-${offsetMinutes}`;
              if (
                await deliverOneMedGroupReminder(db, env, {
                  householdId: household.id,
                  groupId: group.id,
                  groupName,
                  medNames,
                  scheduledAt: pending.scheduledAt,
                  offsetMinutes,
                  tag,
                  now,
                  recipient,
                  subjectLabel,
                  target,
                })
              ) {
                sent += 1;
              }
            }
            continue;
          }

          const schedule = parseFixedTimeSchedule(group.scheduleJson);
          const times = schedule.times ?? [];
          if (times.length === 0) continue;

          for (const { date, hhmm, scheduledAt } of expandScheduledSlots({
            times,
            daysOfWeek: schedule.daysOfWeek,
            startDate: group.startDate,
            endDate: group.endDate,
            dates: datesAround(tz),
            timeZone: tz,
          })) {
            // Which members actually have a dose at THIS specific time — belonging to the
            // group doesn't mean every one of a member's own times matches every group time.
            const membersAtThisTime = memberMeds.filter(
              (m) =>
                m.scheduleKind === "scheduled" &&
                (parseFixedTimeSchedule(m.scheduleJson).times ?? []).some((t) => t.slice(0, 5) === hhmm),
            );
            if (membersAtThisTime.length === 0) continue;
            const membersAtThisTimeIds = membersAtThisTime.map((m) => m.id);
            const medNamesAtThisTime = membersAtThisTime.map((m) => decryptReminderName(m.name, env, "Medication"));

            for (const offsetMinutes of offsets) {
              const fireAt = new Date(scheduledAt.getTime() - offsetMinutes * 60 * 1000);
              if (fireAt > windowEnd) continue;
              if (fireAt < lookbackStart) continue;

              // Partial-take: a group dose stays pending until EVERY member medication has a
              // log for this instant — someone taking 2 of 3 meds early shouldn't suppress the
              // group's reminder before the rest are handled.
              const loggedRows = await db
                .select({ medicationId: healthMedicationLogs.medicationId })
                .from(healthMedicationLogs)
                .where(
                  and(
                    inArray(healthMedicationLogs.medicationId, membersAtThisTimeIds),
                    eq(healthMedicationLogs.scheduledAt, scheduledAt),
                  ),
                );
              if (new Set(loggedRows.map((r) => r.medicationId)).size >= membersAtThisTime.length) {
                continue;
              }

              const tag = `health-medgroup-${group.id}-${date}-${hhmm}-${offsetMinutes}`;
              if (
                await deliverOneMedGroupReminder(db, env, {
                  householdId: household.id,
                  groupId: group.id,
                  groupName,
                  medNames: medNamesAtThisTime,
                  scheduledAt,
                  offsetMinutes,
                  tag,
                  now,
                  recipient,
                  subjectLabel,
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
