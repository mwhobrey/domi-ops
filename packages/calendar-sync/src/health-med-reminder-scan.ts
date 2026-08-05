import type { Env } from "@domi-ops/config";
import { decryptSensitive } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthMedReminderSent,
  healthMedicationLogs,
  healthMedications,
  householdMembers,
  households,
  pushSubscriptions,
  users,
} from "@domi-ops/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { resolveAlertTimeZone } from "./alert-timezone.js";
import { addDaysIso, todayIsoDateInTz, zonedLocalToUtc } from "./household-time.js";
import { nextIntervalPending, parseIntervalSchedule } from "./med-interval-schedule.js";
import {
  deliverUserNotificationToSubscriptions,
  persistUserNotificationOnce,
} from "./user-notify.js";

const WINDOW_MS = 6 * 60 * 1000;
const LOOKBACK_MS = 30 * 60 * 1000;

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

type DeliveryTarget = {
  subscriptionId: string | null;
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
  }
  const [row] = await db
    .select({ id: healthMedReminderSent.id })
    .from(healthMedReminderSent)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
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

      const [member] = await db
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(eq(householdMembers.id, med.memberId))
        .limit(1);
      if (!member?.userId) continue;

      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, member.userId), eq(users.pushHealthRemindersEnabled, true)))
        .limit(1);
      if (!userRow) continue;

      const subs = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userRow.id));

      const targets: DeliveryTarget[] =
        subs.length > 0
          ? subs.map((sub) => ({
              subscriptionId: sub.id,
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
            }))
          : [
              {
                subscriptionId: null,
                timezone: resolveAlertTimeZone({ householdTimezone: householdTz }),
              },
            ];

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

            if (
              await alreadySent(db, med.id, pending.scheduledAt, offsetMinutes, target.subscriptionId)
            ) {
              continue;
            }

            const minutesUntil = Math.max(
              0,
              Math.round((pending.scheduledAt.getTime() - now.getTime()) / 60000),
            );
            const body =
              minutesUntil <= 0
                ? `Time to take ${medName}`
                : `${medName} in ${minutesUntil} min`;
            const tag = `health-med-${med.id}-${date}-${pending.scheduledTime}-${offsetMinutes}`;

            if (target.push) {
              await deliverUserNotificationToSubscriptions(db, env, {
                userId: userRow.id,
                householdId: household.id,
                title: "Medication reminder",
                body,
                url: `/health?medication=${med.id}`,
                tag,
                subscriptions: [target.push],
              });
            } else {
              await persistUserNotificationOnce(db, {
                userId: userRow.id,
                householdId: household.id,
                title: "Medication reminder",
                body,
                url: `/health?medication=${med.id}`,
                tag,
              });
            }

            await db.insert(healthMedReminderSent).values({
              medicationId: med.id,
              scheduledAt: pending.scheduledAt,
              offsetMinutes,
              subscriptionId: target.subscriptionId,
            });
            sent += 1;
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

              if (
                await alreadySent(db, med.id, scheduledAt, offsetMinutes, target.subscriptionId)
              ) {
                continue;
              }

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

              const minutesUntil = Math.max(
                0,
                Math.round((scheduledAt.getTime() - now.getTime()) / 60000),
              );
              const body =
                minutesUntil <= 0
                  ? `Time to take ${medName}`
                  : `${medName} in ${minutesUntil} min`;

              const tag = `health-med-${med.id}-${date}-${hhmm}-${offsetMinutes}`;

              if (target.push) {
                await deliverUserNotificationToSubscriptions(db, env, {
                  userId: userRow.id,
                  householdId: household.id,
                  title: "Medication reminder",
                  body,
                  url: `/health?medication=${med.id}`,
                  tag,
                  subscriptions: [target.push],
                });
              } else {
                await persistUserNotificationOnce(db, {
                  userId: userRow.id,
                  householdId: household.id,
                  title: "Medication reminder",
                  body,
                  url: `/health?medication=${med.id}`,
                  tag,
                });
              }

              await db.insert(healthMedReminderSent).values({
                medicationId: med.id,
                scheduledAt,
                offsetMinutes,
                subscriptionId: target.subscriptionId,
              });
              sent += 1;
            }
          }
        }
      }
    }
  }

  return sent;
}
