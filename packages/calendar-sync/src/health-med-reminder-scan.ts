import type { Env } from "@domi-ops/config";
import {
  decryptSensitive,
  healthMedPushActionSecret,
  mintHealthMedPushActionToken,
} from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthMedReminderSent,
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
  }

  return sent;
}
