import { addDaysUtc } from "./health-organizer-placements.js";
import { zonedLocalToUtc } from "./household-time.js";

/**
 * Fill appointments for a pill organizer (WHO-425): which days they fall on, when each one starts and
 * ends, and whether it counts as done.
 *
 * Dates are household-local calendar days ("YYYY-MM-DD") handled as dates alone, so no part of the schedule
 * depends on a time zone or daylight saving. Only the window of an appointment (its start and end as
 * instants) needs the household's zone, because a day is 23 or 25 hours long when the clocks change.
 */

export type OrganizerSchedule =
  | { kind: "every_n_days"; everyN: number }
  /** A day of the month, 1 to 31. In a month too short for it, the last day of that month. */
  | { kind: "monthly_date"; monthlyDay: number };

/** More dates than any real list needs; a guard against a huge range turning into a huge loop. */
export const MAX_OCCURRENCE_DATES = 500;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parts(iso: string): { y: number; m: number; d: number } {
  if (!ISO.test(iso)) throw new RangeError(`Not a calendar date: ${iso}`);
  addDaysUtc(iso, 0); // throws unless it is a real day
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Whole days from `a` to `b`. */
function diffDays(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/**
 * Every appointment date from `from` to `to` (both included), never before the anchor day, in order.
 * "Every N days" counts from the anchor (the anchor itself is the first). A monthly date falls on that day
 * of each month, or the month's last day when it is shorter (31 in April is the 30th, 29 in a common
 * February is the 28th).
 */
export function organizerOccurrenceDates(schedule: OrganizerSchedule, anchorDate: string, from: string, to: string): string[] {
  parts(anchorDate);
  parts(from);
  parts(to);
  if (to < from) return [];
  const start = from > anchorDate ? from : anchorDate;
  if (to < start) return [];
  const out: string[] = [];

  if (schedule.kind === "every_n_days") {
    if (!Number.isInteger(schedule.everyN) || schedule.everyN < 1) throw new RangeError("everyN must be a positive whole number");
    // The first appointment on or after `start`.
    const sinceAnchor = diffDays(anchorDate, start);
    const steps = Math.ceil(sinceAnchor / schedule.everyN);
    let date = addDaysUtc(anchorDate, steps * schedule.everyN);
    while (date <= to && out.length < MAX_OCCURRENCE_DATES) {
      out.push(date);
      date = addDaysUtc(date, schedule.everyN);
    }
    return out;
  }

  if (!Number.isInteger(schedule.monthlyDay) || schedule.monthlyDay < 1 || schedule.monthlyDay > 31) {
    throw new RangeError("monthlyDay must be 1 to 31");
  }
  const first = parts(start);
  let y = first.y;
  let m = first.m;
  const last = parts(to);
  while ((y < last.y || (y === last.y && m <= last.m)) && out.length < MAX_OCCURRENCE_DATES) {
    const day = Math.min(schedule.monthlyDay, daysInMonth(y, m));
    const date = `${pad(y, 4)}-${pad(m)}-${pad(day)}`;
    if (date >= start && date <= to) out.push(date);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Whether `date` is one of the schedule's appointment days. */
export function isOrganizerOccurrenceDate(schedule: OrganizerSchedule, anchorDate: string, date: string): boolean {
  return organizerOccurrenceDates(schedule, anchorDate, date, date).length === 1;
}

/** The first appointment strictly after `date` (which need not be one), or null if the search runs out. */
export function nextOrganizerOccurrenceAfter(schedule: OrganizerSchedule, anchorDate: string, date: string): string | null {
  // Every real schedule has one within a year and a month; the extra days cover a monthly date after a leap day.
  const found = organizerOccurrenceDates(schedule, anchorDate, addDaysUtc(date, 1), addDaysUtc(date, 400));
  return found[0] ?? null;
}

export type OccurrenceWindow = { start: Date; end: Date };

/** The instant a local day begins. (In zones that change clocks at midnight, the first instant that exists on that day.) */
function startOfLocalDay(date: string, timeZone: string): Date {
  return zonedLocalToUtc(date, "00:00", timeZone);
}

/**
 * When an appointment's day starts and ends in the household's zone: the whole local day. On the days
 * the clocks change that is 23 or 25 hours, not 24.
 */
export function organizerOccurrenceWindow(date: string, timeZone: string): OccurrenceWindow {
  parts(date);
  return { start: startOfLocalDay(date, timeZone), end: startOfLocalDay(addDaysUtc(date, 1), timeZone) };
}

export type OccurrenceStatus = "upcoming" | "today" | "overdue" | "done" | "skipped" | "missed";

export type DerivedOccurrence = {
  status: OccurrenceStatus;
  /** Who made it count as done: the person who said so, or a finished filling session. Null unless done. */
  doneBy: "user" | "session" | null;
};

/**
 * Where an appointment stands. A person's own answer (done, skipped, missed) always wins. Otherwise it is
 * waiting until its day, "today" during it, and after it ends it counts as done by default when a filling
 * session covering it was finished: one started from the appointment, or one finished on its day or the day
 * after. With no such session it is overdue. A moved appointment is judged on the day it moved to.
 */
export function deriveOccurrence(input: {
  outcome: "pending" | "done" | "skipped" | "missed" | "rescheduled";
  /** The day the appointment is actually on: the new day when it was rescheduled. */
  date: string;
  now: Date;
  timeZone: string;
  /** A finished filling session was started from this appointment. */
  linkedSessionFinished: boolean;
  /** Local days on which filling sessions for this plan were finished. */
  sessionFinishedDates: readonly string[];
}): DerivedOccurrence {
  if (input.outcome === "done") return { status: "done", doneBy: "user" };
  if (input.outcome === "skipped") return { status: "skipped", doneBy: null };
  if (input.outcome === "missed") return { status: "missed", doneBy: null };

  if (input.linkedSessionFinished) return { status: "done", doneBy: "session" };
  const window = organizerOccurrenceWindow(input.date, input.timeZone);
  if (input.now < window.start) return { status: "upcoming", doneBy: null };
  if (input.now < window.end) return { status: "today", doneBy: null };
  const dayAfter = addDaysUtc(input.date, 1);
  if (input.sessionFinishedDates.some((d) => d >= input.date && d <= dayAfter)) return { status: "done", doneBy: "session" };
  return { status: "overdue", doneBy: null };
}
