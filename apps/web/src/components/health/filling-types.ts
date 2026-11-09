/**
 * Shapes the filling session endpoints answer with (WHO-426), for the filling screen (WHO-428).
 */

export interface DateRange {
  from: string;
  to: string;
}

export type FillStatus = "pending" | "partial" | "filled" | "nothing_to_fill" | "skipped";

export type SkipReason = "out_of_stock" | "left_out";

export interface SkipView {
  id: string;
  reason: SkipReason;
  createdAt: string;
}

export interface FillView {
  id: string;
  medicationId: string;
  coveredFrom: string;
  coveredTo: string;
  outsideDays: number | null;
  supplyRevision: number | null;
  createdAt: string;
  undoneAt: string | null;
}

export interface SessionPlacement {
  date: string;
  time: string;
  compartmentId: string;
  pills: number;
}

export interface SessionMedication {
  medicationId: string;
  name: string;
  dosage: string | null;
  instructions: string | null;
  status: FillStatus;
  /** Why it is not being filled in this session, if it was skipped. */
  skip: SkipView | null;
  /** Days with a dose, and how many of them are filled. */
  requiredDays: number;
  filledDays: number;
  covered: DateRange[];
  /** Days with a dose that nothing covers yet. */
  missing: DateRange[];
  totalPills: number;
  /** Has a fixed pill dose, so what is left outside the organizers is asked for in pills rather than days. */
  countsPills: boolean;
  byCompartment: Array<{ compartmentId: string; pills: number }>;
  placements: SessionPlacement[];
  lastFill: FillView | null;
}

export interface SessionCompartment {
  id: string;
  name: string;
  position: number;
}

export type ChangeKind = "schedule" | "quantity" | "compartment";

export interface MedicationChange {
  medicationId: string;
  kinds: ChangeKind[];
  added: number;
  removed: number;
  quantityChanged: number;
  compartmentChanged: number;
  /** A few of the days affected, oldest first. */
  dates: string[];
}

export interface CompartmentChange {
  id: string;
  from: string | null;
  to: string | null;
}

/** What differs between the instructions a session started with and the ones that hold now. */
export interface ReviewChanges {
  changed: boolean;
  medications: MedicationChange[];
  compartments: CompartmentChange[];
}

export interface SessionView {
  id: string;
  planId: string;
  status: "open" | "finished" | "abandoned";
  version: number;
  coverageStart: string;
  coverageEnd: string;
  fillLengthDays: number;
  occurrenceDate: string | null;
  startedAt: string;
  finishedAt: string | null;
  abandonedAt: string | null;
  /** The instructions changed since the session started: more filling waits for a review (WHO-429). */
  reviewRequired: boolean;
  changes: ReviewChanges | null;
  compartments: SessionCompartment[];
  medications: SessionMedication[];
  notGuided: Array<{ medicationId: string; reason: string }>;
  progress: { total: number; filled: number; partial: number; pending: number; skipped: number };
  fills: FillView[];
}

export interface SessionDefaults {
  today: string;
  coverageStart: string;
  fillLengthDays: number;
  openSessionId: string | null;
  /** Days a medication that ran out still needs: the next session would otherwise start after them. */
  catchUp: { coverageStart: string; fillLengthDays: number; medicationIds: string[] } | null;
}
