/**
 * Shapes the fill appointment endpoints answer with (WHO-425), for the appointment list and outcomes (WHO-429).
 */

export type AppointmentOutcome = "pending" | "done" | "skipped" | "missed" | "rescheduled";
export type AppointmentStatus = "upcoming" | "today" | "overdue" | "done" | "skipped" | "missed";

export interface Appointment {
  planId: string;
  /** The day the schedule put it on. Identifies the appointment. */
  nominalDate: string;
  /** The day it is actually on: the new day when it was moved. */
  date: string;
  windowStart: string;
  windowEnd: string;
  outcome: AppointmentOutcome;
  status: AppointmentStatus;
  doneBy: "user" | "session" | null;
  rescheduledTo: string | null;
  note: string | null;
  resolvedAt: string | null;
  needsResolution: boolean;
  /** Send this back to change it; 0 while nothing has been said about it. */
  version: number;
  changedAt: string | null;
}

export type AppointmentAction = "start_session" | "reschedule" | "resolve";

export interface AppointmentEffects {
  nextFillDate: string | null;
  coverageEndsOn: string | null;
  earliestRefillDeadline: string | null;
  medications: Array<{
    medicationId: string;
    name: string;
    coverageEndsOn: string | null;
    daysWithoutPills: number;
    runsOutOn: string | null;
    refillDeadline: string | null;
    refillRequested: boolean;
  }>;
  actions: AppointmentAction[];
}

export interface AppointmentEvent {
  fromOutcome: AppointmentOutcome;
  toOutcome: AppointmentOutcome;
  note: string | null;
  at: string;
}

export interface AppointmentList {
  today: string;
  appointments: Appointment[];
  from: string;
  to: string;
  canEdit: boolean;
}

export interface AppointmentDetail {
  appointment: Appointment;
  effects: AppointmentEffects | null;
  events: AppointmentEvent[];
  unchanged?: boolean;
}
