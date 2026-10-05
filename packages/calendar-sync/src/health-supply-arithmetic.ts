import { addDaysUtc } from "./health-organizer-placements.js";
import { zonedLocalToUtc } from "./household-time.js";

/**
 * Medication supply arithmetic (WHO-416): how long a medication lasts, and when to ask for more.
 *
 * Supply here is a user-confirmed ESTIMATE, never live inventory. Nothing in this module reads a dose
 * log; the only inputs are dates a person gave us and the days an organizer was filled for. All dates
 * are household-local calendar days ("YYYY-MM-DD"), so no part of it depends on a time zone, except the
 * one function that turns a deadline day into the moment to remind (nine in the morning, household time).
 *
 * `runsOutOn` is the FIRST date without supply. Fill an organizer for 31 days starting today and keep
 * 10 days of pills outside it: that is 41 days, so you run out on day 42, which is today + 41.
 */

/** How many days before running out to ask for a refill when nobody chose. */
export const DEFAULT_LEAD_DAYS = 7;
export const MAX_LEAD_DAYS = 90;
/** Ten years. A bigger number is a typo, not a supply. */
export const MAX_SUPPLY_DAYS = 3650;
/** Household-local time of day a refill reminder is due. */
export const REFILL_REMINDER_TIME = "09:00";

/** An inclusive run of days, "YYYY-MM-DD" to "YYYY-MM-DD". */
export type DateRange = { from: string; to: string };

/** A real "YYYY-MM-DD" day. `addDaysUtc` refuses anything that does not survive the calendar unchanged. */
function assertDate(iso: string): void {
  try {
    addDaysUtc(iso, 0);
  } catch {
    throw new RangeError(`Not a calendar date: ${iso}`);
  }
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  assertDate(a);
  assertDate(b);
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function assertWholeDays(value: number, label: string, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be a whole number from 0 to ${max}, got ${value}`);
  }
}

/**
 * Sort and merge ranges so days covered twice count once. Ranges that touch (one ends the day before
 * the next begins) join into one, because there is no gap between them.
 */
export function mergeRanges(ranges: readonly DateRange[]): DateRange[] {
  for (const r of ranges) {
    assertDate(r.from);
    assertDate(r.to);
    if (r.to < r.from) throw new RangeError(`Range ends before it starts: ${r.from} to ${r.to}`);
  }
  const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const merged: DateRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.from <= addDaysUtc(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
    } else {
      merged.push({ from: r.from, to: r.to });
    }
  }
  return merged;
}

export type OrganizerCoverage = {
  /** Days in the organizers from today on, counting today, with no gap before them. */
  days: number;
  /** Last day of that stretch, or null when today is not covered. */
  endsOn: string | null;
  /**
   * Coverage exists that the run of days from today does not reach: a gap in the middle, or a fill
   * that starts in the future. The answer then cannot be trusted without the person confirming it.
   */
  hasGap: boolean;
};

/**
 * What the organizers hold from `today`: the unbroken run of covered days starting today. Days before
 * today are gone; days after a gap are not counted (and flag the gap).
 */
export function organizerCoverage(ranges: readonly DateRange[], today: string): OrganizerCoverage {
  assertDate(today);
  // Whatever ends before today is gone. A range that began before today still counts from today: only
  // where the first one ends, and whether it reaches today at all, matters.
  const ahead = mergeRanges(ranges).filter((r) => r.to >= today);
  const first = ahead[0];
  if (!first) return { days: 0, endsOn: null, hasGap: false };
  if (first.from > today) return { days: 0, endsOn: null, hasGap: true };
  return { days: daysBetween(today, first.to) + 1, endsOn: first.to, hasGap: ahead.length > 1 };
}

export type SupplyEstimate =
  | {
      /** The answer depends on a gap in the organizers, so a total must be confirmed first. */
      needsConfirmation: true;
      organizerDays: number;
      organizerEndsOn: string | null;
    }
  | {
      needsConfirmation: false;
      /** Organizer days counted (the unbroken run from today, or less if the total is smaller). */
      organizerDays: number;
      outsideDays: number;
      totalDays: number;
      runsOutOn: string;
      /** True when the person confirmed the total instead of it being added up. */
      confirmed: boolean;
    };

/**
 * Add what is in the organizers to what is outside them and say when it runs out.
 *
 * With a gap in the organizers (or a fill that has not started) the sum would quietly treat missing
 * days as covered or ignore pills that are there, so the caller gets `needsConfirmation` and must come
 * back with `confirmedTotalDays`, the person's own count of days in hand. That total is kept as given:
 * organizer days are whatever unbroken run there is (capped at the total) and the rest is outside.
 */
export function computeSupply(input: {
  today: string;
  /** Days organizers were filled for, from fills that are not undone. */
  ranges: readonly DateRange[];
  /** Days of pills kept outside the organizers. */
  outsideDays: number;
  confirmedTotalDays?: number;
}): SupplyEstimate {
  assertWholeDays(input.outsideDays, "outsideDays", MAX_SUPPLY_DAYS);
  if (input.confirmedTotalDays !== undefined) assertWholeDays(input.confirmedTotalDays, "confirmedTotalDays", MAX_SUPPLY_DAYS);
  const coverage = organizerCoverage(input.ranges, input.today);

  if (coverage.hasGap) {
    if (input.confirmedTotalDays === undefined) {
      return { needsConfirmation: true, organizerDays: coverage.days, organizerEndsOn: coverage.endsOn };
    }
    const organizerDays = Math.min(coverage.days, input.confirmedTotalDays);
    return finish(input.today, organizerDays, input.confirmedTotalDays - organizerDays, true);
  }
  return finish(input.today, coverage.days, input.outsideDays, false);
}

function finish(today: string, organizerDays: number, outsideDays: number, confirmed: boolean): SupplyEstimate {
  const totalDays = organizerDays + outsideDays;
  if (totalDays > MAX_SUPPLY_DAYS) throw new RangeError(`That is ${totalDays} days of supply; the most is ${MAX_SUPPLY_DAYS}`);
  return { needsConfirmation: false, organizerDays, outsideDays, totalDays, runsOutOn: addDaysUtc(today, totalDays), confirmed };
}

/**
 * Days of supply left, as shown: it only ever shrinks as time passes, and is 0 on the run-out day and
 * after. Dose logs never change it.
 */
export function daysRemaining(runsOutOn: string, today: string): number {
  return Math.max(0, daysBetween(today, runsOutOn));
}

/** The lead time to use: the medication's own choice, else the person's, else the default of 7. */
export function effectiveLeadDays(override: number | null | undefined, personDefault: number | null | undefined): number {
  const days = override ?? personDefault ?? DEFAULT_LEAD_DAYS;
  assertWholeDays(days, "lead days", MAX_LEAD_DAYS);
  return days;
}

/** The day a refill reminder is due: `leadDays` before running out. */
export function refillDeadline(runsOutOn: string, leadDays: number): string {
  assertDate(runsOutOn);
  assertWholeDays(leadDays, "lead days", MAX_LEAD_DAYS);
  return addDaysUtc(runsOutOn, -leadDays);
}

/** The moment that deadline day's reminder is due: nine in the morning, household time. */
export function refillReminderAt(deadline: string, timeZone: string): Date {
  assertDate(deadline);
  return zonedLocalToUtc(deadline, REFILL_REMINDER_TIME, timeZone);
}

export type RefillState =
  /** Paused or deleted: nothing is tracked or reminded until it is back. */
  | "inactive"
  /** No estimate has been entered. */
  | "no_estimate"
  /** The supply lasts through the medication's end date, so no refill is needed. */
  | "not_needed"
  | "ok"
  | "needs_refill"
  | "requested";

export type RefillStatus = {
  state: RefillState;
  daysRemaining: number | null;
  deadline: string | null;
  /** Past the deadline day and still not received: needs a refill, or asked for and not here yet. */
  overdue: boolean;
};

/**
 * Where a medication stands on refills today.
 *
 * Needs refill from the deadline day on, until it is requested. Requested wins over the dates and stays
 * until received, even when someone asked early. Overdue means the deadline day has passed, not that it
 * has arrived. A medication whose supply covers its whole course (run-out after its end date) never
 * needs one.
 */
export function refillStatus(input: {
  today: string;
  runsOutOn: string | null;
  leadDays: number;
  /** Last day the medication is taken, if it has one. */
  medicationEndDate: string | null;
  /** Enabled and not deleted. */
  active: boolean;
  requested: boolean;
}): RefillStatus {
  const none = (state: RefillState): RefillStatus => ({ state, daysRemaining: null, deadline: null, overdue: false });
  if (!input.active) return none("inactive");
  if (input.runsOutOn === null) return input.requested ? none("requested") : none("no_estimate");

  const remaining = daysRemaining(input.runsOutOn, input.today);
  const deadline = refillDeadline(input.runsOutOn, input.leadDays);
  if (input.requested) {
    return { state: "requested", daysRemaining: remaining, deadline, overdue: input.today > deadline };
  }
  if (input.medicationEndDate !== null && input.runsOutOn > input.medicationEndDate) {
    return { state: "not_needed", daysRemaining: remaining, deadline: null, overdue: false };
  }
  if (input.today < deadline) return { state: "ok", daysRemaining: remaining, deadline, overdue: false };
  return { state: "needs_refill", daysRemaining: remaining, deadline, overdue: input.today > deadline };
}

/**
 * A medication that was paused and resumed after its estimate was made has not been using pills while
 * paused, so the estimate is stale and has to be confirmed or replaced before reminders carry on.
 * (A medication that is paused right now is simply inactive; see `refillStatus`.)
 */
export function estimateNeedsConfirmation(
  estimateMadeAt: Date,
  pauses: ReadonlyArray<{ pausedAt: Date; resumedAt: Date | null }>,
): boolean {
  return pauses.some((p) => p.resumedAt !== null && p.resumedAt.getTime() > estimateMadeAt.getTime());
}
