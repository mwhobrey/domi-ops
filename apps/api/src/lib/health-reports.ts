import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  healthEvents,
  healthMedicationLogs,
  healthMedications,
  households,
} from "@domi-ops/db";
import {
  isoDateInRange,
  localDateOfInstant,
  todayIsoDateInTz,
} from "@domi-ops/calendar-sync";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { listHouseholdMembersWithAuth, memberShownLabel } from "@domi-ops/auth";
import { healthEventVisibleWhere, healthMedicationVisibleWhere } from "./health-access.js";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";

export const HEALTH_EVENT_TYPE_LABELS: Record<string, string> = {
  sickness: "Sickness",
  injury: "Injury",
  appointment: "Appointment",
  symptom: "Symptom",
  medication: "Medication",
  other: "Other",
};

export const HEALTH_EVENT_TYPES = Object.keys(HEALTH_EVENT_TYPE_LABELS);

export type HealthReportGroupBy = "date" | "eventType" | "none";

/** Soft cap for full history sections (UI + CSV). */
export const HEALTH_EVENT_HISTORY_CAP = 500;
export const HEALTH_MED_LOG_HISTORY_CAP = 500;

type HealthEventRow = typeof healthEvents.$inferSelect;
type HealthMedicationRow = typeof healthMedications.$inferSelect;
type HealthLogRow = typeof healthMedicationLogs.$inferSelect;

export type HealthReportEventItem = {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  memberId: string;
  memberLabel: string;
  notes: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationKind: string;
  ongoing: boolean;
  localDate: string | null;
};

export function normalizeHealthEventType(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  return HEALTH_EVENT_TYPE_LABELS[raw] ? raw : null;
}

export function normalizeHealthReportGroupBy(value: unknown): HealthReportGroupBy {
  if (value === "eventType" || value === "event" || value === "type") return "eventType";
  if (value === "none" || value === "flat") return "none";
  return "date";
}

export function applyHealthEventTypeFilter<T extends { type: string }>(
  rows: T[],
  eventType: string | null | undefined,
): T[] {
  const type = normalizeHealthEventType(eventType);
  if (!type) return rows;
  return rows.filter((r) => r.type === type);
}

export function groupHealthEvents(
  events: HealthReportEventItem[],
  groupBy: HealthReportGroupBy,
): { key: string; label: string; events: HealthReportEventItem[] }[] {
  if (groupBy === "none" || events.length === 0) {
    return events.length === 0 ? [] : [{ key: "all", label: "All events", events }];
  }

  const buckets = new Map<string, { key: string; label: string; events: HealthReportEventItem[] }>();

  for (const event of events) {
    let key: string;
    let label: string;
    if (groupBy === "eventType") {
      key = event.type;
      label = event.typeLabel;
    } else {
      key = event.localDate ?? "unknown";
      label = event.localDate ?? "Unknown date";
    }
    const bucket = buckets.get(key) ?? { key, label, events: [] };
    bucket.events.push(event);
    buckets.set(key, bucket);
  }

  const groups = [...buckets.values()];
  if (groupBy === "date") {
    groups.sort((a, b) => b.key.localeCompare(a.key));
  } else {
    groups.sort((a, b) => a.label.localeCompare(b.label));
  }
  return groups;
}

export function eventOverlapsReportRange(
  row: Pick<HealthEventRow, "startedAt" | "createdAt" | "endedAt" | "durationKind">,
  from: string,
  to: string,
  timezone: string,
  today: string,
): boolean {
  const anchor = row.startedAt ?? row.createdAt;
  const localDate = localDateOfInstant(anchor, timezone);
  if (isoDateInRange(localDate, from, to)) return true;
  if (row.durationKind === "ongoing" && row.startedAt) {
    const start = localDateOfInstant(row.startedAt, timezone);
    const end = row.endedAt ? localDateOfInstant(row.endedAt, timezone) : today;
    return start <= to && end >= from;
  }
  return false;
}

export async function buildHealthReports(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  from: string,
  to: string,
  opts?: {
    memberId?: string | null;
    eventType?: string | null;
    groupBy?: string | null;
  },
) {
  const memberFilter = opts?.memberId?.trim() || null;
  const eventTypeFilter = normalizeHealthEventType(opts?.eventType);
  const groupBy = normalizeHealthReportGroupBy(opts?.groupBy);

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

  let eventsInRange = eventRows.filter((row) =>
    eventOverlapsReportRange(row, from, to, timezone, today),
  );
  if (memberFilter) {
    eventsInRange = eventsInRange.filter((row) => row.memberId === memberFilter);
  }
  eventsInRange = applyHealthEventTypeFilter(eventsInRange, eventTypeFilter);

  const byType: Record<string, number> = {};
  const byMember: Record<string, number> = {};
  let ongoingCount = 0;

  for (const row of eventsInRange) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    byMember[row.memberId] = (byMember[row.memberId] ?? 0) + 1;
    if (row.durationKind === "ongoing" && !row.endedAt) ongoingCount += 1;
  }

  let medRows = await db
    .select()
    .from(healthMedications)
    .where(healthMedicationVisibleWhere(db, auth));
  if (memberFilter) {
    medRows = medRows.filter((row) => row.memberId === memberFilter);
  }

  const medIds = medRows.map((m) => m.id);
  const logRows: HealthLogRow[] =
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
      memberId: med?.memberId ?? "",
      memberLabel: med ? (memberLabel.get(med.memberId) ?? "Member") : "Member",
      ...counts,
      scheduledTotal,
      adherencePct,
    };
  });

  medicationAdherence.sort((a, b) => b.scheduledTotal + b.prn - (a.scheduledTotal + a.prn));

  const mapEvent = (row: HealthEventRow): HealthReportEventItem => {
    const anchor = row.startedAt ?? row.createdAt;
    return {
      id: row.id,
      title: decryptHealthFieldOrPassthrough(row.title, env) ?? "Health event",
      type: row.type,
      typeLabel: HEALTH_EVENT_TYPE_LABELS[row.type] ?? row.type,
      memberId: row.memberId,
      memberLabel: memberLabel.get(row.memberId) ?? "Member",
      notes: decryptHealthFieldOrPassthrough(row.notes, env),
      startedAt: row.startedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      durationKind: row.durationKind,
      ongoing: row.durationKind === "ongoing" && !row.endedAt,
      localDate: localDateOfInstant(anchor, timezone),
    };
  };

  const eventHistory = eventsInRange.slice(0, HEALTH_EVENT_HISTORY_CAP).map(mapEvent);
  const eventGroups = groupHealthEvents(eventHistory, groupBy);
  /** @deprecated Prefer eventHistory — kept for older clients */
  const recentEvents = eventHistory.slice(0, 12);

  const medicationLogHistory = logRows.slice(0, HEALTH_MED_LOG_HISTORY_CAP).map((log) => {
    const med = medById.get(log.medicationId);
    return {
      id: log.id,
      medicationId: log.medicationId,
      medicationName: med
        ? (decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication")
        : "Medication",
      memberId: med?.memberId ?? "",
      memberLabel: med ? (memberLabel.get(med.memberId) ?? "Member") : "Member",
      status: log.status,
      scheduledAt: log.scheduledAt?.toISOString() ?? null,
      loggedAt: log.loggedAt.toISOString(),
      notes: decryptHealthFieldOrPassthrough(log.notes, env),
      prn: log.scheduledAt == null,
    };
  });

  return {
    from,
    to,
    timezone,
    memberId: memberFilter,
    eventType: eventTypeFilter,
    groupBy,
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
      label: HEALTH_EVENT_TYPE_LABELS[type] ?? type,
      count,
    })),
    eventsByMember: Object.entries(byMember).map(([memberId, count]) => ({
      memberId,
      label: memberLabel.get(memberId) ?? "Member",
      count,
    })),
    medicationAdherence,
    eventHistory,
    eventGroups,
    medicationLogHistory,
    recentEvents,
  };
}

/** Pure helper for tests — apply optional member filter after visibility. */
export function applyHealthMemberFilter<T extends { memberId: string }>(
  rows: T[],
  memberId: string | null | undefined,
): T[] {
  const id = memberId?.trim();
  if (!id) return rows;
  return rows.filter((r) => r.memberId === id);
}

export type { HealthMedicationRow };
