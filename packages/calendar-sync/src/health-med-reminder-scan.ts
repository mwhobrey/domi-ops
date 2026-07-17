import type { Env } from "@domi-ops/config";
import { decryptSensitive } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthMedReminderSent,
  healthMedicationLogs,
  healthMedications,
  householdMembers,
  households,
  users,
} from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import { localDateOfInstant, todayIsoDateInTz, zonedLocalToUtc } from "./household-time.js";
import { deliverUserNotification } from "./user-notify.js";

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

function datesAround(now: Date, tz: string): string[] {
  const today = todayIsoDateInTz(tz);
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return [
    yesterday.toISOString().slice(0, 10),
    today,
    tomorrow.toISOString().slice(0, 10),
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
    const tz = household.timezone ?? "UTC";
    const meds = await db
      .select()
      .from(healthMedications)
      .where(
        and(
          eq(healthMedications.householdId, household.id),
          eq(healthMedications.enabled, true),
          eq(healthMedications.scheduleKind, "scheduled"),
        ),
      );

    for (const med of meds) {
      const schedule = parseSchedule(med.scheduleJson);
      const times = schedule.times ?? [];
      if (times.length === 0) continue;

      const offsets = parseOffsets(med.reminderOffsetsJson);
      const medName = decryptMedName(med.name, env);

      for (const date of datesAround(now, tz)) {
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

            const [alreadySent] = await db
              .select({ id: healthMedReminderSent.id })
              .from(healthMedReminderSent)
              .where(
                and(
                  eq(healthMedReminderSent.medicationId, med.id),
                  eq(healthMedReminderSent.scheduledAt, scheduledAt),
                  eq(healthMedReminderSent.offsetMinutes, offsetMinutes),
                ),
              )
              .limit(1);
            if (alreadySent) continue;

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

            // Subject (med.memberId) always has read access under WHO-226 visibility rules.
            const [member] = await db
              .select({ userId: householdMembers.userId })
              .from(householdMembers)
              .where(eq(householdMembers.id, med.memberId))
              .limit(1);
            if (!member?.userId) continue;

            const [userRow] = await db
              .select({ id: users.id })
              .from(users)
              .where(
                and(eq(users.id, member.userId), eq(users.pushHealthRemindersEnabled, true)),
              )
              .limit(1);
            if (!userRow) continue;

            const minutesUntil = Math.max(
              0,
              Math.round((scheduledAt.getTime() - now.getTime()) / 60000),
            );
            const body =
              minutesUntil <= 0
                ? `Time to take ${medName}`
                : `${medName} in ${minutesUntil} min`;

            await deliverUserNotification(db, env, {
              userIds: [userRow.id],
              householdId: household.id,
              title: "Medication reminder",
              body,
              url: `/health?medication=${med.id}`,
              tag: `health-med-${med.id}-${scheduledAt.toISOString()}-${offsetMinutes}`,
            });

            await db.insert(healthMedReminderSent).values({
              medicationId: med.id,
              scheduledAt,
              offsetMinutes,
            });
            sent += 1;
          }
        }
      }
    }
  }

  return sent;
}
