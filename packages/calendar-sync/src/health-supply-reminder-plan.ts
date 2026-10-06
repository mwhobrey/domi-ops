import { refillStatus } from "./health-supply-arithmetic.js";
import { addDaysIso, localDateOfInstant, zonedLocalToUtc } from "./household-time.js";
import type { OccurrenceStatus } from "./health-organizer-occurrences.js";

/**
 * When a pill organizer fill or a medication refill is due a reminder (WHO-432), as plain functions of the clock so every
 * rule can be tested without a database. The scan supplies the facts; these decide.
 *
 * Times are the household's: a fill reminder goes at the plan's reminder time on the appointment's day, a refill reminder
 * at 9:00 on the deadline's day. A reminder that came due while nothing was running is still due on the next scan (the
 * scan records what it sent, so it goes once).
 */

/** The household-local time a refill reminder goes. */
export const REFILL_REMINDER_TIME = "09:00";
/** How far back a missed fill reminder is still worth sending: after this the appointment is history, not news. */
export const FILL_REMINDER_LOOKBACK_DAYS = 3;
/** A requested refill gets one "still waiting" nudge this many days before the supply runs out. */
export const WAITING_NUDGE_DAYS_BEFORE = 2;

/** "09:00:00" or "9:00" -> "09:00". */
function clock(time: string): string {
  const [h = "0", m = "0"] = time.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/** The instant a reminder for `date` goes, in the household's time zone. */
export function reminderInstant(date: string, time: string, timeZone: string): Date {
  return zonedLocalToUtc(date, clock(time), timeZone);
}

export type FillReminderDecision = { due: false } | { due: true; /** The appointment's day has already passed. */ late: boolean };

/**
 * Is a reminder due for a fill appointment? Only for one still to do: on its day (or after it, until it is dealt with)
 * and not done, skipped or missed. `date` is the day it is on, the new one when it was moved.
 */
export function planFillReminder(input: {
  status: OccurrenceStatus;
  date: string;
  /** The plan's "HH:MM" reminder time. */
  reminderTime: string;
  timeZone: string;
  now: Date;
}): FillReminderDecision {
  if (input.status !== "today" && input.status !== "overdue") return { due: false };
  const today = localDateOfInstant(input.now, input.timeZone);
  if (input.date < addDaysIso(today, -FILL_REMINDER_LOOKBACK_DAYS)) return { due: false };
  if (input.now < reminderInstant(input.date, input.reminderTime, input.timeZone)) return { due: false };
  return { due: true, late: input.date < today };
}

export type RefillReminderKind = "refill" | "waiting";

/**
 * Is a reminder due for a medication's supply estimate, and which? "refill" when its deadline has come and nobody has
 * asked the pharmacy; "waiting" (once) when a requested refill has not arrived and the supply runs out in two days.
 * None while the estimate needs confirming after a pause, for a paused, deleted or finished medication, or before the day.
 * An estimate made when the deadline is already behind is due at once: there is no 9:00 to wait for.
 */
export function planRefillReminder(input: {
  runsOutOn: string | null;
  leadDays: number;
  medicationEndDate: string | null;
  /** Enabled and not deleted. */
  active: boolean;
  requested: boolean;
  /** Resumed since the estimate was made, so it is not to be relied on until confirmed. */
  needsConfirmation: boolean;
  timeZone: string;
  now: Date;
}): RefillReminderKind | null {
  if (input.needsConfirmation || input.runsOutOn === null) return null;
  const today = localDateOfInstant(input.now, input.timeZone);
  const status = refillStatus({
    today,
    runsOutOn: input.runsOutOn,
    leadDays: input.leadDays,
    medicationEndDate: input.medicationEndDate,
    active: input.active,
    requested: input.requested,
  });

  if (status.state === "needs_refill" && status.deadline) {
    return input.now >= reminderInstant(status.deadline, REFILL_REMINDER_TIME, input.timeZone) ? "refill" : null;
  }

  if (status.state === "requested") {
    // After the supply has run out there is nothing left to warn about ahead of time.
    if (today > input.runsOutOn) return null;
    const nudgeDay = addDaysIso(input.runsOutOn, -WAITING_NUDGE_DAYS_BEFORE);
    return input.now >= reminderInstant(nudgeDay, REFILL_REMINDER_TIME, input.timeZone) ? "waiting" : null;
  }

  return null;
}

/** "Ally: " in front of a reminder a caregiver gets about someone else; nothing for the person's own. */
function aboutPrefix(isSubject: boolean, subjectLabel: string): string {
  return isSubject ? "" : `${subjectLabel.split(" ")[0] ?? subjectLabel}: `;
}

export function buildFillReminderCopy(input: { isSubject: boolean; subjectLabel: string; late: boolean }): { title: string; body: string } {
  const prefix = aboutPrefix(input.isSubject, input.subjectLabel);
  return {
    title: `${prefix}${input.late ? "Pill organizer fill was due" : "Time to fill the pill organizer"}`,
    body: input.late ? "The fill appointment has passed. Open it to fill now, move it or mark it done." : "Open the fill to see which pills go where.",
  };
}

export function buildRefillReminderCopy(input: {
  kind: RefillReminderKind;
  medicationName: string;
  /** The first day without supply. */
  runsOutOn: string;
  isSubject: boolean;
  subjectLabel: string;
  now: Date;
  timeZone: string;
}): { title: string; body: string } {
  const prefix = aboutPrefix(input.isSubject, input.subjectLabel);
  const today = localDateOfInstant(input.now, input.timeZone);
  const days = Math.round((Date.parse(`${input.runsOutOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const when = days <= 0 ? "has run out" : days === 1 ? "runs out tomorrow" : `runs out in ${days} days`;
  if (input.kind === "waiting") {
    return {
      title: `${prefix}Still waiting on ${input.medicationName}`,
      body: `The refill was requested and has not arrived. The supply ${when}.`,
    };
  }
  return {
    title: `${prefix}Time to refill ${input.medicationName}`,
    body: `The supply ${when}. Ask the pharmacy for a refill and mark it requested.`,
  };
}

export function buildFillReminderDeepLink(input: { planId: string; occurrenceDate: string; memberId: string }): string {
  const params = new URLSearchParams({ fill: input.planId, appointment: input.occurrenceDate, member: input.memberId });
  return `/health?${params.toString()}`;
}

export function buildRefillReminderDeepLink(input: { medicationId: string }): string {
  return `/health?${new URLSearchParams({ supply: input.medicationId }).toString()}`;
}
