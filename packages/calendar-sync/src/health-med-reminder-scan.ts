import type { Env } from "@domi-ops/config";
import {
  decryptSensitive,
  healthMedPushActionSecret,
  mintHealthMedGroupPushActionToken,
  mintHealthMedPushActionToken,
} from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthMedGroupReminderSent,
  healthMedReminderSent,
  healthMedicationGroups,
  healthMedicationLogs,
  healthMedications,
  households,
  pushSubscriptions,
} from "@domi-ops/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { resolveAlertTimeZone } from "./alert-timezone.js";
import {
  listHealthMedReminderRecipients,
  type HealthMedReminderRecipient,
} from "./health-med-reminder-recipients.js";
import { addDaysIso, formatTimeLabelInTz, todayIsoDateInTz, zonedLocalToUtc } from "./household-time.js";
import { nextIntervalPending, parseIntervalSchedule } from "./med-interval-schedule.js";
import {
  deliverUserNotificationToSubscriptions,
  persistUserNotificationOnce,
} from "./user-notify.js";

const MED_PUSH_ACTIONS = [
  { action: "taken", title: "Taken" },
  { action: "skip", title: "Skip" },
] as const;

const WINDOW_MS = 6 * 60 * 1000;
const LOOKBACK_MS = 30 * 60 * 1000;

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

function householdHasHealthModule(modulesEnabled: string): boolean {
  try {
    return (JSON.parse(modulesEnabled) as string[]).includes("health");
  } catch {
    return false;
  }
}

function decryptMedName(nameEnc: string, env: Env): string {
  if (!env.ENCRYPTION_KEY || !nameEnc.startsWith("enc:v1:")) return nameEnc;
  try {
    return decryptSensitive(nameEnc, env.ENCRYPTION_KEY);
  } catch {
    return "Medication";
  }
}

type MedSchedule = { times?: string[]; daysOfWeek?: number[] };

function parseSchedule(raw: string | null | undefined): MedSchedule {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MedSchedule;
  } catch {
    return {};
  }
}

function parseOffsets(raw: string | null | undefined): number[] {
  if (!raw) return [0];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.filter((n): n is number => typeof n === "number" && n >= 0);
  } catch {
    // ignore
  }
  return [0];
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
}): string {
  const whenLabel = (() => {
    try {
      return input.scheduledAt.toLocaleString("en-US", {
        timeZone: input.timeZone,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return `${input.scheduledAt.toISOString().slice(0, 10)} ${input.scheduledAt
        .toISOString()
        .slice(11, 16)}`;
    }
  })();

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
}): string {
  const MAX_NAMED = 3;
  const shown = input.medNames.slice(0, MAX_NAMED);
  const extra = input.medNames.length - shown.length;
  const list = extra > 0 ? `${shown.join(", ")} + ${extra} more` : shown.join(", ");
  const whenLabel = (() => {
    try {
      return input.scheduledAt.toLocaleString("en-US", {
        timeZone: input.timeZone,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return `${input.scheduledAt.toISOString().slice(0, 10)} ${input.scheduledAt
        .toISOString()
        .slice(11, 16)}`;
    }
  })();

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
    }),
  };
}

type DeliveryTarget = {
  subscriptionId: string | null;
  userId: string;
  timezone: string;
  push?: {
    id: string;
    endpoint: string;
    p256dh: string;
    authKey: string;
  };
};

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
      subscriptions: [input.target.push],
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
      subscriptions: [input.target.push],
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

async function targetsForRecipient(
  db: Database,
  recipient: HealthMedReminderRecipient,
  householdTz: string,
): Promise<DeliveryTarget[]> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, recipient.userId));

  if (subs.length > 0) {
    return subs.map((sub) => ({
      subscriptionId: sub.id,
      userId: recipient.userId,
      timezone: resolveAlertTimeZone({
        deviceTimezone: sub.timezone,
        householdTimezone: householdTz,
      }),
      push: {
        id: sub.id,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        authKey: sub.authKey,
      },
    }));
  }

  return [
    {
      subscriptionId: null,
      userId: recipient.userId,
      timezone: resolveAlertTimeZone({ householdTimezone: householdTz }),
    },
  ];
}

export async function scanHealthMedReminders(db: Database, env: Env): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_MS);
  const lookbackStart = new Date(now.getTime() - LOOKBACK_MS);

  const householdRows = await db
    .select({
      id: households.id,
      modulesEnabled: households.modulesEnabled,
      timezone: households.timezone,
    })
    .from(households);

  const enabled = householdRows.filter((h) => householdHasHealthModule(h.modulesEnabled));
  if (enabled.length === 0) return 0;

  let sent = 0;

  for (const household of enabled) {
    const householdTz = household.timezone ?? "UTC";
    const meds = await db
      .select()
      .from(healthMedications)
      .where(
        and(
          eq(healthMedications.householdId, household.id),
          eq(healthMedications.enabled, true),
          inArray(healthMedications.scheduleKind, ["scheduled", "interval"]),
          // A grouped medication's own schedule is preserved-but-inert — the group's schedule
          // (below) is authoritative for it instead. This isNull guard is the entire mechanism.
          isNull(healthMedications.groupId),
        ),
      );

    for (const med of meds) {
      const offsets = parseOffsets(med.reminderOffsetsJson);
      const medName = decryptMedName(med.name, env);

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

          const schedule = parseSchedule(med.scheduleJson);
          const times = schedule.times ?? [];
          if (times.length === 0) continue;

          for (const date of datesAround(tz)) {
            if (med.startDate && date < med.startDate) continue;
            if (med.endDate && date > med.endDate) continue;
            if (schedule.daysOfWeek?.length) {
              const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
              if (!schedule.daysOfWeek.includes(dow)) continue;
            }

            for (const time of times) {
              const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
              const scheduledAt = zonedLocalToUtc(date, hhmm, tz);

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
    }

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

    for (const group of groups) {
      const memberMeds = await db
        .select()
        .from(healthMedications)
        .where(
          and(eq(healthMedications.groupId, group.id), eq(healthMedications.householdId, household.id)),
        );
      if (memberMeds.length === 0) continue;
      const memberMedIds = memberMeds.map((m) => m.id);
      const medNames = memberMeds.map((m) => decryptMedName(m.name, env));

      const offsets = parseOffsets(group.reminderOffsetsJson);
      const groupName = decryptMedName(group.name, env);

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

          const schedule = parseSchedule(group.scheduleJson);
          const times = schedule.times ?? [];
          if (times.length === 0) continue;

          for (const date of datesAround(tz)) {
            if (group.startDate && date < group.startDate) continue;
            if (group.endDate && date > group.endDate) continue;
            if (schedule.daysOfWeek?.length) {
              const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
              if (!schedule.daysOfWeek.includes(dow)) continue;
            }

            for (const time of times) {
              const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
              const scheduledAt = zonedLocalToUtc(date, hhmm, tz);

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
                      inArray(healthMedicationLogs.medicationId, memberMedIds),
                      eq(healthMedicationLogs.scheduledAt, scheduledAt),
                    ),
                  );
                if (new Set(loggedRows.map((r) => r.medicationId)).size >= memberMeds.length) continue;

                const tag = `health-medgroup-${group.id}-${date}-${hhmm}-${offsetMinutes}`;
                if (
                  await deliverOneMedGroupReminder(db, env, {
                    householdId: household.id,
                    groupId: group.id,
                    groupName,
                    medNames,
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
  }

  return sent;
}
