import { ApiError } from "../../lib/client-api";
import { count } from "./filling-helpers";
import { apiErrorCode } from "./pharmacy-helpers";
import { formatDay } from "./supply-helpers";
import type { Appointment, AppointmentDetail, AppointmentEffects, AppointmentOutcome } from "./appointment-types";

/**
 * Pure helpers for the fill appointment list and outcomes (WHO-429): what needs attention, how an appointment reads,
 * what skipping or moving it affects, and what to say when the API refuses. Dates are household calendar days.
 */

export type AppointmentGroups = {
  /** Skipped, missed or overdue, and nobody has dealt with it yet: nearest first. */
  attention: Appointment[];
  /** Still ahead (or today), soonest first. */
  upcoming: Appointment[];
  /** Done, or dealt with: latest first. */
  recent: Appointment[];
};

/** Sorts a list of appointments into what needs attention, what is coming and what is behind. */
export function groupAppointments(appointments: readonly Appointment[]): AppointmentGroups {
  const byDate = (a: Appointment, b: Appointment) => a.date.localeCompare(b.date) || a.nominalDate.localeCompare(b.nominalDate);
  const attention: Appointment[] = [];
  const upcoming: Appointment[] = [];
  const recent: Appointment[] = [];
  for (const a of appointments) {
    if (a.needsResolution) attention.push(a);
    else if (a.status === "upcoming" || a.status === "today") upcoming.push(a);
    else recent.push(a);
  }
  return { attention: attention.sort(byDate), upcoming: upcoming.sort(byDate), recent: recent.sort((a, b) => byDate(b, a)) };
}

export type StatusView = { label: string; tone: "default" | "success" | "warning" | "accent" | "danger" };

/** The badge for an appointment: "Today", "Overdue", "Done" (and by whom), "Skipped", "Missed", "Moved". */
export function appointmentStatus(a: Pick<Appointment, "status" | "outcome" | "doneBy">): StatusView {
  if (a.outcome === "rescheduled" && (a.status === "upcoming" || a.status === "today")) {
    return a.status === "today" ? { label: "Today (moved)", tone: "accent" } : { label: "Moved", tone: "default" };
  }
  switch (a.status) {
    case "today":
      return { label: "Today", tone: "accent" };
    case "upcoming":
      return { label: "Upcoming", tone: "default" };
    case "overdue":
      return { label: "Overdue", tone: "danger" };
    case "done":
      return { label: a.doneBy === "session" ? "Done (filled)" : "Done", tone: "success" };
    case "skipped":
      return { label: "Skipped", tone: "warning" };
    case "missed":
      return { label: "Missed", tone: "danger" };
  }
}

/** "Oct 6", or "Oct 9 (moved from Oct 6)" when it was moved. */
export function appointmentDayLabel(a: Pick<Appointment, "date" | "nominalDate">): string {
  return a.date === a.nominalDate ? formatDay(a.date) : `${formatDay(a.date)} (moved from ${formatDay(a.nominalDate)})`;
}

export const OUTCOME_LABELS: Record<AppointmentOutcome, string> = {
  pending: "Not yet",
  done: "Done",
  skipped: "Skipped",
  missed: "Missed",
  rescheduled: "Moved to another day",
};

/** The outcomes someone can pick for an appointment: "missed" is something that already happened, so not ahead of the day. */
export function outcomeChoices(a: Pick<Appointment, "status" | "outcome">): AppointmentOutcome[] {
  const ahead = (a.status === "upcoming" || a.status === "today") && a.outcome !== "skipped" && a.outcome !== "missed";
  return ahead ? ["done", "skipped", "rescheduled", "pending"] : ["done", "skipped", "missed", "rescheduled", "pending"];
}

/** What the person is told about an appointment's effects, one sentence each. Empty when there is nothing to say. */
export function effectLines(effects: AppointmentEffects | null): string[] {
  if (!effects) return [];
  const lines: string[] = [];
  if (effects.nextFillDate) lines.push(`Pills next go into the organizer on ${formatDay(effects.nextFillDate)}.`);
  if (effects.coverageEndsOn) lines.push(`What is in the organizers lasts until ${formatDay(effects.coverageEndsOn)}.`);
  else lines.push("There are no pills in the organizers now.");
  if (effects.earliestRefillDeadline) lines.push(`The earliest refill to ask for is by ${formatDay(effects.earliestRefillDeadline)}.`);
  return lines;
}

/** "Metformin: 4 days without pills in the organizer before the next fill. Supply runs out Oct 20. Ask for a refill by Oct 15." */
export function medicationEffectLine(m: AppointmentEffects["medications"][number]): string {
  const parts: string[] = [];
  if (m.daysWithoutPills > 0) parts.push(`${count(m.daysWithoutPills, "day")} without pills in the organizer before the next fill.`);
  if (m.runsOutOn) parts.push(`Supply runs out ${formatDay(m.runsOutOn)}.`);
  if (m.refillDeadline) parts.push(m.refillRequested ? "Refill already requested." : `Ask for a refill by ${formatDay(m.refillDeadline)}.`);
  return `${m.name}: ${parts.join(" ") || "nothing to do."}`;
}

/** The appointment (with its effects) a conflict answer carries, so the screen can show what is true now. */
export function appointmentFromConflict(err: unknown): Pick<AppointmentDetail, "appointment" | "effects"> | null {
  if (!(err instanceof ApiError) || !err.body) return null;
  try {
    const body = JSON.parse(err.body) as { appointment?: Appointment; effects?: AppointmentEffects | null };
    const a = body.appointment;
    return a && typeof a === "object" && typeof a.nominalDate === "string" && typeof a.version === "number" ? { appointment: a, effects: body.effects ?? null } : null;
  } catch {
    return null;
  }
}

const MESSAGES: Record<string, string> = {
  version_conflict: "Someone else changed this appointment, so it was reloaded. Check it and try again.",
  date_taken: "Another appointment is already on that day. Pick a different one.",
  reschedule_needs_date: "Pick the day it moves to.",
  invalid_reschedule_date: "Pick a different day, within a year of this one.",
  invalid_note: "The note can be up to 500 characters.",
  appointment_not_found: "That appointment no longer exists. The schedule may have changed.",
  nothing_to_resolve: "There is nothing left to deal with for this appointment.",
  forbidden: "You do not have permission to change this organizer.",
  plan_not_found: "That organizer no longer exists.",
};

/** A sentence for the person, never a raw code. */
export function appointmentErrorMessage(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  return (code && MESSAGES[code]) || fallback;
}
