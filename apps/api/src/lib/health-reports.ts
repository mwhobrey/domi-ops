import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  healthEvents,
  healthMedicationLogs,
  healthMedications,
  households,
} from "@whome/db";
import {
  isoDateInRange,
  localDateOfInstant,
  todayIsoDateInTz,
} from "@whome/calendar-sync";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { listHouseholdMembersWithAuth, memberShownLabel } from "@whome/auth";
import { healthEventVisibleWhere, healthMedicationVisibleWhere } from "./health-access.js";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";

const EVENT_TYPE_LABELS: Record<string, string> = {
  sickness: "Sickness",
  injury: "Injury",
  appointment: "Appointment",
  symptom: "Symptom",
  medication: "Medication",
  other: "Other",
};

export async function buildHealthReports(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  from: string,
  to: string,
) {
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, auth.householdId))
    .limit(1);
  const timezone = household?.timezone ?? "UTC";
  const today = todayIsoDateInTz(timezone);

  const roster = await listHouseholdMembersWithAuth(db, auth.householdId);
  const memberLabel = new Map(
    roster.map((m) => [
      m.memberId,
      memberShownLabel({ name: m.name }) || m.username || m.email || "Member",
    ]),
  );

  const eventRows = await db
    .select()
    .from(healthEvents)
    .where(healthEventVisibleWhere(db, auth))
    .orderBy(desc(healthEvents.startedAt));

  const eventsInRange = eventRows.filter((row) => {
    const anchor = row.startedAt ?? row.createdAt;
    const localDate = localDateOfInstant(anchor, timezone);
    if (isoDateInRange(localDate, from, to)) return true;
    if (row.durationKind === "ongoing" && row.startedAt) {
      const start = localDateOfInstant(row.startedAt, timezone);
      const end = row.endedAt ? localDateOfInstant(row.endedAt, timezone) : today;
      return start <= to && end >= from;
    }
    return false;
  });

  const byType: Record<string, number> = {};
  const byMember: Record<string, number> = {};
  let ongoingCount = 0;

  for (const row of eventsInRange) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    byMember[row.memberId] = (byMember[row.memberId] ?? 0) + 1;
    if (row.durationKind === "ongoing" && !row.endedAt) ongoingCount += 1;
  }

  const medRows = await db
    .select()
    .from(healthMedications)
    .where(healthMedicationVisibleWhere(db, auth));

  const medIds = medRows.map((m) => m.id);
  const logRows =
    medIds.length === 0
      ? []
      : await db
          .select()
          .from(healthMedicationLogs)
          .where(
            and(
              inArray(healthMedicationLogs.medicationId, medIds),
              gte(healthMedicationLogs.loggedAt, new Date(`${from}T00:00:00.000Z`)),
              lte(healthMedicationLogs.loggedAt, new Date(`${to}T23:59:59.999Z`)),
            ),
          )
          .orderBy(desc(healthMedicationLogs.loggedAt));

  const medById = new Map(medRows.map((m) => [m.id, m]));
  const adherence: Record<
    string,
    { taken: number; skipped: number; missed: number; prn: number }
  > = {};

  for (const log of logRows) {
    const bucket = adherence[log.medicationId] ?? {
      taken: 0,
      skipped: 0,
      missed: 0,
      prn: 0,
    };
    if (log.scheduledAt == null) {
      bucket.prn += 1;
    } else if (log.status === "taken") {
      bucket.taken += 1;
    } else if (log.status === "skipped") {
      bucket.skipped += 1;
    } else if (log.status === "missed") {
      bucket.missed += 1;
    }
    adherence[log.medicationId] = bucket;
  }

  const medicationAdherence = Object.entries(adherence).map(([medicationId, counts]) => {
    const med = medById.get(medicationId);
    const name = med
      ? (decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication")
      : "Medication";
    const scheduledTotal = counts.taken + counts.skipped + counts.missed;
    const adherencePct =
      scheduledTotal > 0 ? Math.round((counts.taken / scheduledTotal) * 100) : null;
    return {
      medicationId,
      name,
      scheduleKind: med?.scheduleKind ?? "scheduled",
      ...counts,
      scheduledTotal,
      adherencePct,
    };
  });

  medicationAdherence.sort((a, b) => b.scheduledTotal + b.prn - (a.scheduledTotal + a.prn));

  const recentEvents = eventsInRange.slice(0, 12).map((row) => ({
    id: row.id,
    title: decryptHealthFieldOrPassthrough(row.title, env) ?? "Health event",
    type: row.type,
    typeLabel: EVENT_TYPE_LABELS[row.type] ?? row.type,
    memberLabel: memberLabel.get(row.memberId) ?? "Member",
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    durationKind: row.durationKind,
    ongoing: row.durationKind === "ongoing" && !row.endedAt,
  }));

  return {
    from,
    to,
    timezone,
    summary: {
      totalEvents: eventsInRange.length,
      ongoingCount,
      activeMedications: medRows.filter((m) => m.enabled).length,
      scheduledMedications: medRows.filter((m) => m.enabled && m.scheduleKind === "scheduled")
        .length,
      prnMedications: medRows.filter((m) => m.enabled && m.scheduleKind === "prn").length,
      dosesLogged: logRows.length,
    },
    eventsByType: Object.entries(byType).map(([type, count]) => ({
      type,
      label: EVENT_TYPE_LABELS[type] ?? type,
      count,
    })),
    eventsByMember: Object.entries(byMember).map(([memberId, count]) => ({
      memberId,
      label: memberLabel.get(memberId) ?? "Member",
      count,
    })),
    medicationAdherence,
    recentEvents,
  };
}
