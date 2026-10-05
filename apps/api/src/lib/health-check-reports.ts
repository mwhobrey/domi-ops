import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthChecks, healthEvents, households } from "@domi-ops/db";
import {
  addDaysIso,
  datesBetween,
  formatTimeLabelInTz,
  loadCheckSlotStatuses,
  localDateOfInstant,
  todayIsoDateInTz,
  zonedLocalToUtc,
  type SlotStatus,
} from "@domi-ops/calendar-sync";
import { listHouseholdMembersWithAuth, memberShownLabel } from "@domi-ops/auth";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import { healthCheckVisibleWhere } from "./health-check-access.js";
import { healthEventReportsVisibleWhere } from "./health-access.js";
import { isUuid } from "./uuid.js";
import { loadVitalsReadingsForEvents } from "./health-serialize.js";

/** Longest range a check report covers; the slot logic walks every day in it. */
export const MAX_CHECK_REPORT_DAYS = 366;

type Auth = { householdId: string; userId: string; memberId: string; role: string };

export class CheckReportRangeError extends Error {
  constructor(public readonly code: "invalid_date" | "end_before_start" | "range_too_large" | "invalid_member") {
    super(code);
    this.name = "CheckReportRangeError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, not just something shaped like one ("2026-13-40"). */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * A person filter has to be a UUID before it reaches a query: Postgres rejects anything else, which
 * would come back as a 500 instead of a 400.
 */
export function assertCheckReportMember(memberId: string | null | undefined): void {
  if (memberId && !isUuid(memberId)) throw new CheckReportRangeError("invalid_member");
}

/** Validate a report range; the caller turns the error code into a 400. */
export function assertCheckReportRange(from: string, to: string): void {
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new CheckReportRangeError("invalid_date");
  if (to < from) throw new CheckReportRangeError("end_before_start");
  if (datesBetween(from, to).length > MAX_CHECK_REPORT_DAYS) throw new CheckReportRangeError("range_too_large");
}

// ---------------------------------------------------------------------------------------------
// Adherence: how many of the times a check asked for an answer got one
// ---------------------------------------------------------------------------------------------

/** What a slot counts as in the report, or null while it is still ahead (or just came due). */
export function adherenceOutcome(status: SlotStatus): "done" | "skipped" | "missed" | null {
  switch (status) {
    case "done":
      return "done";
    case "skipped":
      return "skipped";
    // `missed` is a system-written log; `overdue` is unanswered past the tolerance window. Both
    // are a time that passed with nothing recorded.
    case "missed":
    case "overdue":
      return "missed";
    default:
      return null;
  }
}

export function completionPercent(done: number, due: number): number | null {
  return due > 0 ? Math.round((done / due) * 100) : null;
}

export type AdherenceGap = {
  date: string;
  timeLabel: string;
  scheduledAt: string;
  checkName: string;
  memberLabel: string;
  status: "skipped" | "missed";
};

export type CheckAdherenceRow = {
  checkId: string;
  name: string;
  memberId: string;
  memberLabel: string;
  due: number;
  done: number;
  skipped: number;
  missed: number;
  completionPercent: number | null;
};

export type CheckAdherenceReport = {
  from: string;
  to: string;
  timezone: string;
  totals: { due: number; done: number; skipped: number; missed: number; completionPercent: number | null };
  byCheck: CheckAdherenceRow[];
  /** Skipped and missed times, oldest first, capped; `gapsTruncated` says when there were more. */
  gaps: AdherenceGap[];
  gapsTruncated: boolean;
};

const MAX_GAPS = 300;

/**
 * How well scheduled checks were kept over a range (WHO-393).
 *
 * - A time counts once it has an outcome: logged, skipped, or passed with nothing recorded. A time
 *   still ahead, or only just due, is not counted against anyone yet.
 * - A check has no history before the day it was set up, so those days are not counted as missed.
 * - "Done" is out of everything that was due, so a skip lowers the figure just as a miss does; the
 *   two are listed separately because they mean different things to a doctor.
 * - Paused stretches never produce times, and deleted checks stay in the history they earned.
 */
export async function buildCheckAdherenceReport(
  db: Database,
  env: Env,
  auth: Auth,
  from: string,
  to: string,
  opts: { memberId?: string | null; now?: Date } = {},
): Promise<CheckAdherenceReport> {
  assertCheckReportRange(from, to);
  assertCheckReportMember(opts.memberId);
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, auth.householdId))
    .limit(1);
  const timezone = household?.timezone ?? "UTC";
  const now = opts.now ?? new Date();
  const today = todayIsoDateInTz(timezone);
  const effectiveTo = to < today ? to : today;

  const empty: CheckAdherenceReport = {
    from,
    to,
    timezone,
    totals: { due: 0, done: 0, skipped: 0, missed: 0, completionPercent: null },
    byCheck: [],
    gaps: [],
    gapsTruncated: false,
  };
  if (from > effectiveTo) return empty;

  const checks = await db
    .select()
    .from(healthChecks)
    .where(
      and(
        healthCheckVisibleWhere(db, auth),
        opts.memberId ? eq(healthChecks.memberId, opts.memberId) : undefined,
      ),
    );
  if (checks.length === 0) return empty;

  const roster = await listHouseholdMembersWithAuth(db, auth.householdId);
  const memberLabels = new Map(
    roster.map((m) => [m.memberId, memberShownLabel({ name: m.name }) || m.username || m.email || "Member"]),
  );

  const statuses = await loadCheckSlotStatuses(db, env, {
    checks,
    from,
    to: effectiveTo,
    timeZone: timezone,
    now,
    includeAwaitingFirst: false,
  });

  const byCheck: CheckAdherenceRow[] = [];
  const gaps: AdherenceGap[] = [];
  for (const check of checks) {
    const name = decryptHealthFieldOrPassthrough(check.name, env) ?? "Health check";
    const memberLabel = memberLabels.get(check.memberId) ?? "Member";
    const firstDay = localDateOfInstant(check.createdAt, timezone);
    const row: CheckAdherenceRow = {
      checkId: check.id,
      name,
      memberId: check.memberId,
      memberLabel,
      due: 0,
      done: 0,
      skipped: 0,
      missed: 0,
      completionPercent: null,
    };
    for (const slot of statuses.get(check.id) ?? []) {
      const outcome = adherenceOutcome(slot.status);
      if (!outcome) continue;
      const date = localDateOfInstant(slot.scheduledAt, timezone);
      if (date < firstDay) continue;
      row.due += 1;
      row[outcome] += 1;
      if (outcome !== "done") {
        gaps.push({
          date,
          timeLabel: formatTimeLabelInTz(slot.scheduledAt, timezone),
          scheduledAt: slot.scheduledAt.toISOString(),
          checkName: name,
          memberLabel,
          status: outcome,
        });
      }
    }
    row.completionPercent = completionPercent(row.done, row.due);
    // A check with nothing due in the range (new, paused throughout) would only add a blank row.
    if (row.due > 0) byCheck.push(row);
  }

  byCheck.sort((a, b) => a.memberLabel.localeCompare(b.memberLabel) || a.name.localeCompare(b.name));
  gaps.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.checkName.localeCompare(b.checkName));

  const totals = byCheck.reduce(
    (t, r) => ({
      due: t.due + r.due,
      done: t.done + r.done,
      skipped: t.skipped + r.skipped,
      missed: t.missed + r.missed,
    }),
    { due: 0, done: 0, skipped: 0, missed: 0 },
  );

  return {
    from,
    to,
    timezone,
    totals: { ...totals, completionPercent: completionPercent(totals.done, totals.due) },
    byCheck,
    gaps: gaps.slice(0, MAX_GAPS),
    gapsTruncated: gaps.length > MAX_GAPS,
  };
}

// ---------------------------------------------------------------------------------------------
// Blood pressure: the readings, laid out for a doctor
// ---------------------------------------------------------------------------------------------

export type BloodPressurePeriod = "Morning" | "Afternoon" | "Evening";

/** Morning is 5:00-11:59, afternoon 12:00-17:59, and evening is everything after, through the night. */
export function periodOfDay(hour: number): BloodPressurePeriod {
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 18) return "Afternoon";
  return "Evening";
}

export type BloodPressureReading = {
  eventId: string;
  date: string;
  timeLabel: string;
  at: string;
  hour: number;
  systolic: number;
  diastolic: number;
  heartRate: number | null;
};

function mean(values: number[]): number | null {
  return values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

export type BloodPressureSummary = {
  count: number;
  avgSystolic: number | null;
  avgDiastolic: number | null;
  avgHeartRate: number | null;
  lowest: BloodPressureReading | null;
  highest: BloodPressureReading | null;
  byPeriod: { period: BloodPressurePeriod; count: number; avgSystolic: number | null; avgDiastolic: number | null }[];
};

/**
 * Averages, the lowest and highest reading (by systolic, then diastolic), and the same averages by
 * time of day. Plain numbers only: this reports what was measured and leaves what it means to the
 * doctor.
 */
export function summarizeBloodPressure(readings: readonly BloodPressureReading[]): BloodPressureSummary {
  const sorted = [...readings].sort((a, b) => a.systolic - b.systolic || a.diastolic - b.diastolic);
  const periods: BloodPressurePeriod[] = ["Morning", "Afternoon", "Evening"];
  return {
    count: readings.length,
    avgSystolic: mean(readings.map((r) => r.systolic)),
    avgDiastolic: mean(readings.map((r) => r.diastolic)),
    avgHeartRate: mean(readings.flatMap((r) => (r.heartRate != null ? [r.heartRate] : []))),
    lowest: sorted[0] ?? null,
    highest: sorted[sorted.length - 1] ?? null,
    byPeriod: periods
      .map((period) => {
        const inPeriod = readings.filter((r) => periodOfDay(r.hour) === period);
        return {
          period,
          count: inPeriod.length,
          avgSystolic: mean(inPeriod.map((r) => r.systolic)),
          avgDiastolic: mean(inPeriod.map((r) => r.diastolic)),
        };
      })
      .filter((p) => p.count > 0),
  };
}

export type BloodPressurePerson = {
  memberId: string;
  memberLabel: string;
  summary: BloodPressureSummary;
  readings: BloodPressureReading[];
};

export type BloodPressureReport = {
  from: string;
  to: string;
  timezone: string;
  people: BloodPressurePerson[];
};

/**
 * Every blood pressure reading in a range, per person, with the summary a doctor wants (WHO-393).
 * A reading is a vitals entry that holds both a systolic and a diastolic value, wherever it came
 * from (a scheduled check or the Log tab); the heart rate comes along when it was taken with it.
 * Only entries the viewer is allowed to see in reports are included.
 */
export async function buildBloodPressureReport(
  db: Database,
  env: Env,
  auth: Auth,
  from: string,
  to: string,
  opts: { memberId?: string | null } = {},
): Promise<BloodPressureReport> {
  assertCheckReportRange(from, to);
  assertCheckReportMember(opts.memberId);
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, auth.householdId))
    .limit(1);
  const timezone = household?.timezone ?? "UTC";

  const rangeStart = zonedLocalToUtc(from, "00:00", timezone);
  const rangeEnd = zonedLocalToUtc(addDaysIso(to, 1), "00:00", timezone);
  const events = await db
    .select()
    .from(healthEvents)
    .where(
      and(
        healthEventReportsVisibleWhere(db, auth),
        eq(healthEvents.type, "vitals"),
        opts.memberId ? eq(healthEvents.memberId, opts.memberId) : undefined,
        gte(healthEvents.startedAt, rangeStart),
        lt(healthEvents.startedAt, rangeEnd),
      ),
    )
    .orderBy(asc(healthEvents.startedAt));

  const readingsByEvent = await loadVitalsReadingsForEvents(
    db,
    env,
    events.map((e) => e.id),
  );

  const roster = await listHouseholdMembersWithAuth(db, auth.householdId);
  const memberLabels = new Map(
    roster.map((m) => [m.memberId, memberShownLabel({ name: m.name }) || m.username || m.email || "Member"]),
  );

  const byMember = new Map<string, BloodPressureReading[]>();
  for (const event of events) {
    if (!event.startedAt) continue;
    const metrics = readingsByEvent.get(event.id) ?? [];
    const value = (metric: string) => metrics.find((m) => m.metric === metric)?.value;
    const systolic = value("blood_pressure_systolic");
    const diastolic = value("blood_pressure_diastolic");
    if (typeof systolic !== "number" || typeof diastolic !== "number") continue;
    const heartRate = value("heart_rate");
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(
        event.startedAt,
      ),
    );
    const reading: BloodPressureReading = {
      eventId: event.id,
      date: localDateOfInstant(event.startedAt, timezone),
      timeLabel: formatTimeLabelInTz(event.startedAt, timezone),
      at: event.startedAt.toISOString(),
      hour,
      systolic,
      diastolic,
      heartRate: typeof heartRate === "number" ? heartRate : null,
    };
    byMember.set(event.memberId, [...(byMember.get(event.memberId) ?? []), reading]);
  }

  const people = [...byMember.entries()]
    .map(([memberId, readings]) => ({
      memberId,
      memberLabel: memberLabels.get(memberId) ?? "Member",
      summary: summarizeBloodPressure(readings),
      readings,
    }))
    .sort((a, b) => a.memberLabel.localeCompare(b.memberLabel));

  return { from, to, timezone, people };
}
