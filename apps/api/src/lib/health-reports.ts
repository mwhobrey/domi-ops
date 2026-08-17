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
  formatTimeLabelInTz,
  isMidnightInTz,
  isoDateInRange,
  localDateOfInstant,
  nextIntervalPending,
  parseIntervalSchedule,
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
  startedAtLabel: string;
  endedAt: string | null;
  endedAtLabel: string | null;
  durationKind: string;
  ongoing: boolean;
  localDate: string | null;
};

export type HealthTodayDoseStatus = "taken" | "skipped" | "missed" | "pending" | "prn";

export type HealthTodayDoseRow = {
  medicationId: string;
  medicationName: string;
  dosage: string | null;
  memberId: string;
  memberLabel: string;
  scheduleKind: string;
  status: HealthTodayDoseStatus;
  statusLabel: string;
  scheduledAt: string | null;
  scheduledAtLabel: string;
  loggedAt: string | null;
  loggedAtLabel: string | null;
  notes: string | null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatHealthInstantLabel(
  instant: Date | string | null | undefined,
  timeZone: string,
  opts?: { dateOnly?: boolean },
): string {
  if (!instant) return "—";
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    const dateOpts: Intl.DateTimeFormatOptions = {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    };
    if (opts?.dateOnly) {
      return new Intl.DateTimeFormat("en-US", dateOpts).format(d);
    }
    return new Intl.DateTimeFormat("en-US", {
      ...dateOpts,
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return opts?.dateOnly ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function formatHealthWhenLabel(
  instant: Date | string | null | undefined,
  timeZone: string,
  fallbackDate?: string | null,
): string {
  if (!instant) {
    return fallbackDate ? formatHealthInstantLabel(`${fallbackDate}T12:00:00Z`, timeZone, { dateOnly: true }) : "—";
  }
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return fallbackDate ?? "—";
  if (isMidnightInTz(d, timeZone)) {
    return formatHealthInstantLabel(d, timeZone, { dateOnly: true });
  }
  return formatHealthInstantLabel(d, timeZone);
}

function formatClockLabel(hhmm: string, timeZone: string): string {
  const time = hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm;
  try {
    return formatTimeLabelInTz(zonedLocalToUtc("2026-01-15", time, timeZone), timeZone);
  } catch {
    return time;
  }
}

export function formatMedScheduleSummary(
  scheduleKind: string,
  scheduleJson: string | null | undefined,
  timeZone = "UTC",
): string {
  if (scheduleKind === "prn") return "As needed (PRN)";
  if (scheduleKind === "interval") {
    const schedule = parseIntervalSchedule(scheduleJson);
    if (!schedule) return "Interval";
    const every =
      schedule.everyMinutes % 60 === 0
        ? `every ${schedule.everyMinutes / 60} hour${schedule.everyMinutes === 60 ? "" : "s"}`
        : `every ${schedule.everyMinutes} minutes`;
    const start =
      schedule.anchor === "fixed_start" && schedule.fixedStartTime
        ? ` starting ${formatClockLabel(schedule.fixedStartTime, timeZone)}`
        : " from first dose";
    let stop = "";
    if (schedule.stop.mode === "max_doses" && schedule.stop.maxDoses) {
      stop = `; stop after ${schedule.stop.maxDoses} dose${schedule.stop.maxDoses === 1 ? "" : "s"}`;
    } else if (schedule.stop.mode === "end_time" && schedule.stop.endTime) {
      stop = `; until ${formatClockLabel(schedule.stop.endTime, timeZone)}`;
    } else if (schedule.stop.mode === "midnight") {
      stop = "; until midnight";
    }
    return `Interval, ${every}${start}${stop}`;
  }
  const schedule = parseMedSchedule(scheduleJson);
  const times = (schedule.times ?? []).map((t) => formatClockLabel(t, timeZone));
  const timePart = times.length > 0 ? times.join(", ") : "no times set";
  const days = schedule.daysOfWeek?.filter((d) => d >= 0 && d <= 6) ?? [];
  if (days.length > 0 && days.length < 7) {
    const dayPart = [...days]
      .sort((a, b) => a - b)
      .map((d) => DAY_NAMES[d] ?? String(d))
      .join(", ");
    return `${dayPart} at ${timePart}`;
  }
  return `Daily at ${timePart}`;
}

export function todayDoseStatusLabel(status: HealthTodayDoseStatus): string {
  if (status === "prn") return "PRN taken";
  if (status === "pending") return "Pending";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function buildTodayDoseRows(input: {
  date: string;
  timeZone: string;
  now?: Date;
  meds: {
    id: string;
    name: string;
    dosage: string | null;
    memberId: string;
    memberLabel: string;
    scheduleKind: string;
    scheduleJson: string | null;
    startDate: string | null;
    endDate: string | null;
    enabled: boolean;
  }[];
  logs: {
    medicationId: string;
    status: string;
    scheduledAt: Date | null;
    loggedAt: Date;
    notes: string | null;
  }[];
}): HealthTodayDoseRow[] {
  const now = input.now ?? new Date();
  const today = todayIsoDateInTz(input.timeZone);
  const rows: HealthTodayDoseRow[] = [];
  const logsByMed = new Map<string, typeof input.logs>();
  for (const log of input.logs) {
    const list = logsByMed.get(log.medicationId) ?? [];
    list.push(log);
    logsByMed.set(log.medicationId, list);
  }

  const pushRow = (
    med: (typeof input.meds)[number],
    status: HealthTodayDoseStatus,
    scheduledAt: Date | null,
    loggedAt: Date | null,
    notes: string | null,
    scheduledLabel?: string,
  ) => {
    rows.push({
      medicationId: med.id,
      medicationName: med.name,
      dosage: med.dosage,
      memberId: med.memberId,
      memberLabel: med.memberLabel,
      scheduleKind: med.scheduleKind,
      status,
      statusLabel: todayDoseStatusLabel(status),
      scheduledAt: scheduledAt?.toISOString() ?? null,
      scheduledAtLabel:
        scheduledLabel ??
        (scheduledAt ? formatHealthWhenLabel(scheduledAt, input.timeZone) : "—"),
      loggedAt: loggedAt?.toISOString() ?? null,
      loggedAtLabel: loggedAt ? formatHealthInstantLabel(loggedAt, input.timeZone) : null,
      notes,
    });
  };

  for (const med of input.meds) {
    if (!med.enabled) continue;
    if (med.startDate && input.date < med.startDate) continue;
    if (med.endDate && input.date > med.endDate) continue;
    const logs = logsByMed.get(med.id) ?? [];

    if (med.scheduleKind === "scheduled") {
      const expected = enumerateScheduledDoseInstants({
        scheduleJson: med.scheduleJson,
        startDate: med.startDate,
        endDate: med.endDate,
        from: input.date,
        to: input.date,
        timeZone: input.timeZone,
      });
      const byIso = new Map<string, (typeof logs)[number]>();
      for (const log of logs) {
        if (log.scheduledAt) byIso.set(log.scheduledAt.toISOString(), log);
      }
      for (const instant of expected) {
        const log = byIso.get(instant.toISOString());
        if (log) {
          const status: HealthTodayDoseStatus =
            log.status === "skipped" ? "skipped" : log.status === "missed" ? "missed" : "taken";
          pushRow(med, status, instant, log.loggedAt, log.notes);
          continue;
        }
        if (instant.getTime() > now.getTime()) {
          pushRow(med, "pending", instant, null, null);
        } else {
          pushRow(med, "missed", instant, null, null);
        }
      }
      continue;
    }

    if (med.scheduleKind === "prn") {
      for (const log of logs) {
        if (log.scheduledAt != null) continue;
        if (localDateOfInstant(log.loggedAt, input.timeZone) !== input.date) continue;
        pushRow(med, "prn", null, log.loggedAt, log.notes, formatHealthInstantLabel(log.loggedAt, input.timeZone));
      }
      continue;
    }

    if (med.scheduleKind === "interval") {
      for (const log of logs) {
        const when = log.scheduledAt ?? log.loggedAt;
        if (localDateOfInstant(when, input.timeZone) !== input.date) continue;
        const status: HealthTodayDoseStatus =
          log.status === "skipped" ? "skipped" : log.status === "missed" ? "missed" : "taken";
        pushRow(med, status, log.scheduledAt, log.loggedAt, log.notes);
      }
      if (input.date === today) {
        const schedule = parseIntervalSchedule(med.scheduleJson);
        if (schedule) {
          const pending = nextIntervalPending({
            schedule,
            tz: input.timeZone,
            date: input.date,
            now,
            logs: logs.map((l) => ({
              scheduledAt: l.scheduledAt,
              loggedAt: l.loggedAt,
              status: l.status,
            })),
          });
          if (pending) {
            pushRow(
              med,
              "pending",
              pending.scheduledAt,
              null,
              null,
              pending.awaitingFirst ? "First dose" : pending.scheduledTimeLabel,
            );
          }
        }
      }
    }
  }

  rows.sort((a, b) => {
    const aKey = a.scheduledAt ?? a.loggedAt ?? "";
    const bKey = b.scheduledAt ?? b.loggedAt ?? "";
    return aKey.localeCompare(bKey) || a.memberLabel.localeCompare(b.memberLabel);
  });
  return rows;
}

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
  fromInput: string,
  toInput: string,
  opts?: {
    memberId?: string | null;
    eventType?: string | null;
    groupBy?: string | null;
    medicationId?: string | null;
    scheduleKind?: string | null;
    pinToToday?: boolean;
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
  const from = opts?.pinToToday ? today : fromInput;
  const to = opts?.pinToToday ? today : toInput;
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
  const logFrom = new Date(`${from}T00:00:00.000Z`);
  logFrom.setUTCDate(logFrom.getUTCDate() - 1);
  const logTo = new Date(`${to}T23:59:59.999Z`);
  logTo.setUTCDate(logTo.getUTCDate() + 1);
  const logRows: HealthLogRow[] =
    medIds.length === 0
      ? []
      : await db
          .select()
          .from(healthMedicationLogs)
          .where(
            and(
              inArray(healthMedicationLogs.medicationId, medIds),
              gte(healthMedicationLogs.loggedAt, logFrom),
              lte(healthMedicationLogs.loggedAt, logTo),
            ),
          )
          .orderBy(desc(healthMedicationLogs.loggedAt));

  const medById = new Map(medRows.map((m) => [m.id, m]));
  const logsInLocalRange = logRows.filter((log) => {
    const date = localDateOfInstant(log.loggedAt, timezone);
    return date >= from && date <= to;
  });
  const logsByMed = new Map<string, HealthLogRow[]>();
  for (const log of logsInLocalRange) {
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
    logs: logsInLocalRange,
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
      startedAtLabel: formatHealthWhenLabel(row.startedAt ?? row.createdAt, timezone),
      endedAt: row.endedAt?.toISOString() ?? null,
      endedAtLabel: row.endedAt ? formatHealthWhenLabel(row.endedAt, timezone) : null,
      durationKind: row.durationKind,
      ongoing: row.durationKind === "ongoing" && !row.endedAt,
      localDate: localDateOfInstant(anchor, timezone),
    };
  };

  const eventHistory = eventsInRange.slice(0, HEALTH_EVENT_HISTORY_CAP).map(mapEvent);
  const eventGroups = groupHealthEvents(eventHistory, groupBy);
  /** @deprecated Prefer eventHistory — kept for older clients */
  const recentEvents = eventHistory.slice(0, 12);

  const medicationLogHistory = logsInLocalRange.slice(0, HEALTH_MED_LOG_HISTORY_CAP).map((log) => {
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
      scheduledAtLabel: log.scheduledAt ? formatHealthInstantLabel(log.scheduledAt, timezone) : null,
      loggedAt: log.loggedAt.toISOString(),
      loggedAtLabel: formatHealthInstantLabel(log.loggedAt, timezone),
      notes: decryptHealthFieldOrPassthrough(log.notes, env),
      prn: log.scheduledAt == null,
    };
  });

  const medicationList = medRows.map((m) => ({
    id: m.id,
    name: decryptHealthFieldOrPassthrough(m.name, env) ?? "Medication",
    dosage: decryptHealthFieldOrPassthrough(m.dosage, env),
    instructions: decryptHealthFieldOrPassthrough(m.instructions, env),
    scheduleKind: m.scheduleKind,
    scheduleSummary: formatMedScheduleSummary(m.scheduleKind, m.scheduleJson, timezone),
    memberId: m.memberId,
    memberLabel: memberLabel.get(m.memberId) ?? "Member",
    enabled: m.enabled,
    startDate: m.startDate,
    endDate: m.endDate,
  }));
  medicationList.sort((a, b) =>
    a.memberLabel === b.memberLabel
      ? a.name.localeCompare(b.name)
      : a.memberLabel.localeCompare(b.memberLabel),
  );

  const todayDoseDate = from === to ? from : today;
  const todayDoses = buildTodayDoseRows({
    date: todayDoseDate,
    timeZone: timezone,
    now,
    meds: medRows.map((m) => ({
      id: m.id,
      name: decryptHealthFieldOrPassthrough(m.name, env) ?? "Medication",
      dosage: decryptHealthFieldOrPassthrough(m.dosage, env),
      memberId: m.memberId,
      memberLabel: memberLabel.get(m.memberId) ?? "Member",
      scheduleKind: m.scheduleKind,
      scheduleJson: m.scheduleJson,
      startDate: m.startDate,
      endDate: m.endDate,
      enabled: m.enabled,
    })),
    logs: logRows.map((l) => ({
      medicationId: l.medicationId,
      status: l.status,
      scheduledAt: l.scheduledAt,
      loggedAt: l.loggedAt,
      notes: decryptHealthFieldOrPassthrough(l.notes, env),
    })),
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
      dosesLogged: logsInLocalRange.length,
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
    medications: medicationList,
    eventHistory,
    eventGroups,
    medicationLogHistory,
    todayDoses,
    todayDoseDate,
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
