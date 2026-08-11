import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  healthEvents,
  healthMedicationLogs,
  healthMedications,
  households,
} from "@domi-ops/db";
import {
  addDaysIso,
  isoDateInRange,
  localDateOfInstant,
  todayIsoDateInTz,
  zonedLocalToUtc,
} from "@domi-ops/calendar-sync";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { listHouseholdMembersWithAuth, memberShownLabel } from "@domi-ops/auth";
import {
  healthEventReportsVisibleWhere,
  healthMedicationReportsVisibleWhere,
} from "./health-access.js";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import { parseMedSchedule } from "./health-serialize.js";

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
export type HealthReportScheduleKind = "scheduled" | "prn" | "interval";

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

export function isoDatesInInclusiveRange(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  let cur = from;
  // Cap expansion to ~2 years to avoid runaway
  for (let i = 0; i < 800 && cur <= to; i += 1) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

/** Expected clock times (UTC) for a scheduled med over [from, to] inclusive local dates. */
export function enumerateScheduledDoseInstants(input: {
  scheduleJson: string | null;
  startDate: string | null;
  endDate: string | null;
  from: string;
  to: string;
  timeZone: string;
}): Date[] {
  const schedule = parseMedSchedule(input.scheduleJson);
  const times = schedule.times ?? [];
  if (times.length === 0) return [];
  const instants: Date[] = [];
  for (const date of isoDatesInInclusiveRange(input.from, input.to)) {
    if (input.startDate && date < input.startDate) continue;
    if (input.endDate && date > input.endDate) continue;
    if (schedule.daysOfWeek?.length) {
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (!schedule.daysOfWeek.includes(dow)) continue;
    }
    for (const time of times) {
      const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
      instants.push(zonedLocalToUtc(date, hhmm, input.timeZone));
    }
  }
  return instants;
}

/**
 * Expected-vs-taken for scheduled meds.
 * Past slots without taken/skipped → missed. Future slots → pending (not in %.
 */
export function computeExpectedScheduledAdherence(input: {
  expected: Date[];
  logs: { scheduledAt: Date | null; status: string }[];
  now?: Date;
}): {
  expected: number;
  taken: number;
  skipped: number;
  missed: number;
  pending: number;
  adherencePct: number | null;
} {
  const now = input.now ?? new Date();
  const byIso = new Map<string, string>();
  for (const log of input.logs) {
    if (!log.scheduledAt) continue;
    byIso.set(log.scheduledAt.toISOString(), log.status);
  }

  let taken = 0;
  let skipped = 0;
  let missed = 0;
  let pending = 0;

  for (const expected of input.expected) {
    const status = byIso.get(expected.toISOString());
    if (status === "taken") {
      taken += 1;
      continue;
    }
    if (status === "skipped") {
      skipped += 1;
      continue;
    }
    if (status === "missed" || expected.getTime() <= now.getTime()) {
      missed += 1;
      continue;
    }
    pending += 1;
  }

  const due = taken + skipped + missed;
  return {
    expected: input.expected.length,
    taken,
    skipped,
    missed,
    pending,
    adherencePct: due > 0 ? Math.round((taken / due) * 100) : null,
  };
}

export function buildPrnFrequencyByDay(input: {
  logs: { medicationId: string; loggedAt: Date; scheduledAt: Date | null }[];
  medById: Map<string, { memberId: string }>;
  memberLabel: Map<string, string>;
  timeZone: string;
}): { date: string; memberId: string; memberLabel: string; count: number }[] {
  const buckets = new Map<string, { date: string; memberId: string; memberLabel: string; count: number }>();
  for (const log of input.logs) {
    if (log.scheduledAt != null) continue;
    const med = input.medById.get(log.medicationId);
    if (!med) continue;
    const date = localDateOfInstant(log.loggedAt, input.timeZone);
    const key = `${date}:${med.memberId}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, {
        date,
        memberId: med.memberId,
        memberLabel: input.memberLabel.get(med.memberId) ?? "Member",
        count: 1,
      });
    }
  }
  return [...buckets.values()].sort((a, b) =>
    a.date === b.date ? a.memberLabel.localeCompare(b.memberLabel) : b.date.localeCompare(a.date),
  );
}

export function normalizeHealthScheduleKind(value: unknown): HealthReportScheduleKind | null {
  if (value === "scheduled" || value === "prn" || value === "interval") return value;
  return null;
}

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
    medicationId?: string | null;
    scheduleKind?: string | null;
  },
) {
  const memberFilter = opts?.memberId?.trim() || null;
  const eventTypeFilter = normalizeHealthEventType(opts?.eventType);
  const groupBy = normalizeHealthReportGroupBy(opts?.groupBy);
  const medicationFilter = opts?.medicationId?.trim() || null;
  const scheduleKindFilter = normalizeHealthScheduleKind(opts?.scheduleKind);

  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, auth.householdId))
    .limit(1);
  const timezone = household?.timezone ?? "UTC";
  const today = todayIsoDateInTz(timezone);
  const now = new Date();
  const adherenceTo = to < today ? to : today;

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
    .where(healthEventReportsVisibleWhere(db, auth))
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
    .where(healthMedicationReportsVisibleWhere(db, auth));
  if (memberFilter) {
    medRows = medRows.filter((row) => row.memberId === memberFilter);
  }
  if (medicationFilter) {
    medRows = medRows.filter((row) => row.id === medicationFilter);
  }
  if (scheduleKindFilter) {
    medRows = medRows.filter((row) => row.scheduleKind === scheduleKindFilter);
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
  const logsByMed = new Map<string, HealthLogRow[]>();
  for (const log of logRows) {
    const list = logsByMed.get(log.medicationId) ?? [];
    list.push(log);
    logsByMed.set(log.medicationId, list);
  }

  const medicationAdherence = medRows.map((med) => {
    const name = decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication";
    const logs = logsByMed.get(med.id) ?? [];
    const prn = logs.filter((l) => l.scheduledAt == null).length;

    if (med.scheduleKind === "scheduled") {
      const expected = enumerateScheduledDoseInstants({
        scheduleJson: med.scheduleJson,
        startDate: med.startDate,
        endDate: med.endDate,
        from,
        to: adherenceTo,
        timeZone: timezone,
      });
      const computed = computeExpectedScheduledAdherence({
        expected,
        logs: logs.map((l) => ({ scheduledAt: l.scheduledAt, status: l.status })),
        now,
      });
      return {
        medicationId: med.id,
        name,
        scheduleKind: med.scheduleKind,
        memberId: med.memberId,
        memberLabel: memberLabel.get(med.memberId) ?? "Member",
        taken: computed.taken,
        skipped: computed.skipped,
        missed: computed.missed,
        pending: computed.pending,
        expected: computed.expected,
        prn,
        scheduledTotal: computed.taken + computed.skipped + computed.missed,
        adherencePct: computed.adherencePct,
      };
    }

    let taken = 0;
    let skipped = 0;
    let missed = 0;
    for (const log of logs) {
      if (log.scheduledAt == null) continue;
      if (log.status === "taken") taken += 1;
      else if (log.status === "skipped") skipped += 1;
      else if (log.status === "missed") missed += 1;
    }
    const scheduledTotal = taken + skipped + missed;
    return {
      medicationId: med.id,
      name,
      scheduleKind: med.scheduleKind,
      memberId: med.memberId,
      memberLabel: memberLabel.get(med.memberId) ?? "Member",
      taken,
      skipped,
      missed,
      pending: 0,
      expected: scheduledTotal,
      prn,
      scheduledTotal,
      adherencePct:
        scheduledTotal > 0 ? Math.round((taken / scheduledTotal) * 100) : med.scheduleKind === "prn" ? null : null,
    };
  });

  medicationAdherence.sort((a, b) => b.scheduledTotal + b.prn - (a.scheduledTotal + a.prn));

  const prnFrequency = buildPrnFrequencyByDay({
    logs: logRows,
    medById,
    memberLabel,
    timeZone: timezone,
  });

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
    medicationId: medicationFilter,
    scheduleKind: scheduleKindFilter,
    summary: {
      totalEvents: eventsInRange.length,
      ongoingCount,
      activeMedications: medRows.filter((m) => m.enabled).length,
      scheduledMedications: medRows.filter((m) => m.enabled && m.scheduleKind === "scheduled")
        .length,
      intervalMedications: medRows.filter((m) => m.enabled && m.scheduleKind === "interval")
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
    prnFrequency,
    medications: medRows.map((m) => ({
      id: m.id,
      name: decryptHealthFieldOrPassthrough(m.name, env) ?? "Medication",
      scheduleKind: m.scheduleKind,
      memberId: m.memberId,
      memberLabel: memberLabel.get(m.memberId) ?? "Member",
      enabled: m.enabled,
    })),
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
