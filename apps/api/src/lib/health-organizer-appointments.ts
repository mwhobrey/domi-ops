import {
  addDaysUtc,
  daysBetween,
  deriveOccurrence,
  nextOrganizerOccurrenceAfter,
  organizerOccurrenceDates,
  organizerOccurrenceWindow,
  organizerCoverage,
  todayIsoDateInTz,
  type DateRange,
  type OccurrenceStatus,
  type OrganizerSchedule,
} from "@domi-ops/calendar-sync";
import {
  healthMedications,
  healthOrganizerOccurrenceEvents,
  healthOrganizerOccurrences,
  healthOrganizerSessionFills,
  healthOrganizerSessions,
  type Database,
} from "@domi-ops/db";
import type { Env } from "@domi-ops/config";
import { and, asc, between, eq, inArray, isNull } from "drizzle-orm";
import { healthMedicationVisibleWhere } from "./health-access.js";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import { loadSupplyViews } from "./health-supply.js";
import { HEALTH_CAPS } from "./health-quota.js";
import { householdTimezone } from "./household-time.js";
import type { PlanRow } from "./health-organizer-plan.js";

/**
 * Fill appointments and what happened to each (WHO-425). The dates come from the plan's schedule and are
 * never stored; a row exists only once someone says something about an appointment (done, skipped, missed,
 * moved, a note, or that they have dealt with it). Whether an appointment counts as done on its own is worked
 * out when it is read, from the filling sessions finished around it.
 */

type Auth = { userId: string; householdId: string; memberId: string; role: string };
type OccurrenceRow = typeof healthOrganizerOccurrences.$inferSelect;

export type Outcome = "pending" | "done" | "skipped" | "missed" | "rescheduled";

export type AppointmentView = {
  planId: string;
  /** The day the schedule put it on. Identifies the appointment. */
  nominalDate: string;
  /** The day it is actually on: the new day when it was moved. */
  date: string;
  windowStart: string;
  windowEnd: string;
  /** What was said about it. "pending" until something is. */
  outcome: Outcome;
  status: OccurrenceStatus;
  /** For a done appointment: the person who said so, or a finished filling session. */
  doneBy: "user" | "session" | null;
  rescheduledTo: string | null;
  note: string | null;
  resolvedAt: string | null;
  /** Skipped, missed or overdue, and nobody has dealt with it yet. */
  needsResolution: boolean;
  /** Send this back to change it; 0 while nothing has been said about it. */
  version: number;
  changedAt: string | null;
};

export type AppointmentEvent = { fromOutcome: Outcome; toOutcome: Outcome; note: string | null; at: string };

export function planSchedule(plan: PlanRow): OrganizerSchedule {
  return plan.scheduleKind === "every_n_days"
    ? { kind: "every_n_days", everyN: plan.everyN as number }
    : { kind: "monthly_date", monthlyDay: plan.monthlyDay as number };
}

/** The last day an appointment can be set on: the Nth one ahead of today, N being the cap. */
export function lastSettableDate(plan: PlanRow, today: string): string {
  const ahead = organizerOccurrenceDates(planSchedule(plan), plan.anchorDate, addDaysUtc(today, 1), addDaysUtc(today, 3700));
  return ahead[Math.min(HEALTH_CAPS.occurrencesAhead.max, ahead.length) - 1] ?? today;
}

function buildView(
  plan: PlanRow,
  env: Env,
  nominalDate: string,
  row: OccurrenceRow | undefined,
  ctx: { now: Date; timeZone: string; finishedLinked: Set<string>; finishedDates: string[] },
): AppointmentView {
  const outcome = (row?.outcome ?? "pending") as Outcome;
  const date = row?.rescheduledTo ?? nominalDate;
  const derived = deriveOccurrence({
    outcome,
    date,
    now: ctx.now,
    timeZone: ctx.timeZone,
    linkedSessionFinished: row ? ctx.finishedLinked.has(row.id) : false,
    sessionFinishedDates: ctx.finishedDates,
  });
  const window = organizerOccurrenceWindow(date, ctx.timeZone);
  const resolvedAt = row?.resolvedAt ?? null;
  return {
    planId: plan.id,
    nominalDate,
    date,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    outcome,
    status: derived.status,
    doneBy: derived.doneBy,
    rescheduledTo: row?.rescheduledTo ?? null,
    note: decryptHealthFieldOrPassthrough(row?.note ?? null, env),
    resolvedAt: resolvedAt?.toISOString() ?? null,
    needsResolution: resolvedAt === null && (derived.status === "skipped" || derived.status === "missed" || derived.status === "overdue"),
    version: row?.version ?? 0,
    changedAt: row?.outcomeChangedAt?.toISOString() ?? null,
  };
}

async function loadContext(db: Database, plan: PlanRow, auth: Auth) {
  const timeZone = await householdTimezone(db, auth.householdId);
  const sessions = await db
    .select({ id: healthOrganizerSessions.id, occurrenceId: healthOrganizerSessions.occurrenceId, finishedAt: healthOrganizerSessions.finishedAt })
    .from(healthOrganizerSessions)
    .where(and(eq(healthOrganizerSessions.planId, plan.id), eq(healthOrganizerSessions.status, "finished")));
  const finishedLinked = new Set<string>();
  const finishedDates: string[] = [];
  for (const s of sessions) {
    if (s.occurrenceId) finishedLinked.add(s.occurrenceId);
    if (s.finishedAt) finishedDates.push(s.finishedAt.toLocaleDateString("en-CA", { timeZone }));
  }
  return { now: new Date(), timeZone, today: todayIsoDateInTz(timeZone), finishedLinked, finishedDates };
}

export async function loadOccurrenceRow(db: Database, planId: string, nominalDate: string): Promise<OccurrenceRow | undefined> {
  const [row] = await db
    .select()
    .from(healthOrganizerOccurrences)
    .where(and(eq(healthOrganizerOccurrences.planId, planId), eq(healthOrganizerOccurrences.occurrenceDate, nominalDate)))
    .limit(1);
  return row;
}

/** One appointment as it stands, whether or not anything has been said about it. */
export async function loadAppointment(db: Database, env: Env, auth: Auth, plan: PlanRow, nominalDate: string): Promise<AppointmentView> {
  const ctx = await loadContext(db, plan, auth);
  return buildView(plan, env, nominalDate, await loadOccurrenceRow(db, plan.id, nominalDate), ctx);
}

/**
 * The appointments whose day falls between `from` and `to`, oldest first: the schedule's days (no more than the
 * cap ahead of today) with what was said about each, and any appointment moved into the range from outside it.
 * One moved out of the range is not listed.
 */
export async function loadAppointments(
  db: Database,
  env: Env,
  auth: Auth,
  plan: PlanRow,
  from: string,
  to: string,
): Promise<{ today: string; appointments: AppointmentView[] }> {
  const ctx = await loadContext(db, plan, auth);
  // Something can be moved at most a year either way, so rows that far outside the range can still land in it.
  const rows = await db
    .select()
    .from(healthOrganizerOccurrences)
    .where(
      and(
        eq(healthOrganizerOccurrences.planId, plan.id),
        between(healthOrganizerOccurrences.occurrenceDate, addDaysUtc(from, -370), addDaysUtc(to, 370)),
      ),
    );
  const byNominal = new Map(rows.map((r) => [r.occurrenceDate, r]));

  const lastAhead = lastSettableDate(plan, ctx.today);
  const generated = organizerOccurrenceDates(planSchedule(plan), plan.anchorDate, from, to < lastAhead ? to : lastAhead);
  const nominal = new Set(generated);
  for (const row of rows) if (row.rescheduledTo && row.rescheduledTo >= from && row.rescheduledTo <= to) nominal.add(row.occurrenceDate);

  const views = [...nominal]
    .map((d) => buildView(plan, env, d, byNominal.get(d), ctx))
    .filter((v) => v.date >= from && v.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.nominalDate.localeCompare(b.nominalDate));
  return { today: ctx.today, appointments: views };
}

export async function loadEvents(db: Database, env: Env, occurrenceId: string): Promise<AppointmentEvent[]> {
  const rows = await db
    .select()
    .from(healthOrganizerOccurrenceEvents)
    .where(eq(healthOrganizerOccurrenceEvents.occurrenceId, occurrenceId))
    .orderBy(asc(healthOrganizerOccurrenceEvents.createdAt));
  return rows.map((r) => ({
    fromOutcome: r.fromOutcome as Outcome,
    toOutcome: r.toOutcome as Outcome,
    note: decryptHealthFieldOrPassthrough(r.note, env),
    at: r.createdAt.toISOString(),
  }));
}

export type AppointmentEffects = {
  /** The appointment after this one, or the new day when it was moved: when pills next go into the organizer. */
  nextFillDate: string | null;
  /** The earliest day the organizers run out of pills for any medication they hold, counting from today. Null when none hold any. */
  coverageEndsOn: string | null;
  /** The earliest refill deadline among the medications listed. */
  earliestRefillDeadline: string | null;
  /** Medications that would go without pills in the organizer before the next fill, or run out of supply by then. */
  medications: Array<{
    medicationId: string;
    name: string;
    /** The last day pills are in the organizer for it (from today), or null if there are none. */
    coverageEndsOn: string | null;
    /** Days between the end of that coverage and the next fill. */
    daysWithoutPills: number;
    runsOutOn: string | null;
    refillDeadline: string | null;
    refillRequested: boolean;
  }>;
  /** What the person can do about it. */
  actions: Array<"start_session" | "reschedule" | "resolve">;
};

/**
 * What skipping, missing or moving an appointment affects: how far the pills already in the organizers last,
 * which medications would go without before the next fill, and when their refills fall due. Written from
 * what `auth` can see, like everything else about a person's medications.
 */
export async function computeEffects(db: Database, env: Env, auth: Auth, plan: PlanRow, appointment: AppointmentView): Promise<AppointmentEffects> {
  const ctx = await loadContext(db, plan, auth);
  const nextFillDate =
    appointment.outcome === "rescheduled" ? appointment.date : nextOrganizerOccurrenceAfter(planSchedule(plan), plan.anchorDate, appointment.nominalDate);

  const meds = await db
    .select()
    .from(healthMedications)
    .where(
      and(
        eq(healthMedications.memberId, plan.memberId),
        isNull(healthMedications.deletedAt),
        eq(healthMedications.enabled, true),
        eq(healthMedications.scheduleKind, "scheduled"),
        healthMedicationVisibleWhere(db, auth),
      ),
    );
  const fills = meds.length
    ? await db
        .select({ medicationId: healthOrganizerSessionFills.medicationId, from: healthOrganizerSessionFills.coveredFrom, to: healthOrganizerSessionFills.coveredTo })
        .from(healthOrganizerSessionFills)
        .where(and(inArray(healthOrganizerSessionFills.medicationId, meds.map((m) => m.id)), isNull(healthOrganizerSessionFills.undoneAt)))
    : [];
  const rangesByMed = new Map<string, DateRange[]>();
  for (const f of fills) {
    const list = rangesByMed.get(f.medicationId) ?? [];
    list.push({ from: f.from, to: f.to });
    rangesByMed.set(f.medicationId, list);
  }
  const supply = await loadSupplyViews(db, env, auth.householdId, meds);

  const listed: AppointmentEffects["medications"] = [];
  let coverageEndsOn: string | null = null;
  for (const med of meds) {
    const coverage = organizerCoverage(rangesByMed.get(med.id) ?? [], ctx.today);
    if (coverage.endsOn && (coverageEndsOn === null || coverage.endsOn < coverageEndsOn)) coverageEndsOn = coverage.endsOn;
    const uncoveredFrom = coverage.endsOn ? addDaysUtc(coverage.endsOn, 1) : ctx.today;
    const daysWithoutPills = nextFillDate ? Math.max(0, daysBetween(uncoveredFrom, nextFillDate)) : 0;
    const s = supply.get(med.id)?.supply;
    const runsOutBeforeNextFill = Boolean(s?.runsOutOn && nextFillDate && s.runsOutOn <= nextFillDate && s.state !== "not_needed");
    if (daysWithoutPills > 0 || runsOutBeforeNextFill) {
      listed.push({
        medicationId: med.id,
        name: decryptHealthFieldOrPassthrough(med.name, env) ?? "",
        coverageEndsOn: coverage.endsOn,
        daysWithoutPills,
        runsOutOn: s?.runsOutOn ?? null,
        refillDeadline: s?.deadline ?? null,
        refillRequested: s?.requestedAt != null,
      });
    }
  }
  listed.sort((a, b) => (a.refillDeadline ?? "9999-12-31").localeCompare(b.refillDeadline ?? "9999-12-31") || a.name.localeCompare(b.name));
  const deadlines = listed.map((m) => m.refillDeadline).filter((d): d is string => d !== null);

  return {
    nextFillDate,
    coverageEndsOn,
    earliestRefillDeadline: deadlines.length ? deadlines.reduce((a, b) => (a < b ? a : b)) : null,
    medications: listed,
    actions: ["start_session", "reschedule", ...(appointment.needsResolution ? (["resolve"] as const) : [])],
  };
}

/** Whether the effects are worth showing for this appointment. */
export function hasEffects(appointment: AppointmentView): boolean {
  return appointment.outcome === "rescheduled" || appointment.status === "skipped" || appointment.status === "missed" || appointment.status === "overdue";
}
