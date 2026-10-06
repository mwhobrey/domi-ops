/**
 * Shapes the pill organizer plan endpoints answer with (WHO-424), for the setup screens (WHO-427).
 */

export type OrganizerScheduleKind = "every_n_days" | "monthly_date";

export interface OrganizerCompartment {
  id: string;
  name: string;
  position: number;
}

export type SetupProblem =
  | { kind: "unmapped_time"; severity: "error"; time: string; medicationIds: string[] }
  | { kind: "missing_quantity"; severity: "error"; medicationId: string; time: string }
  | { kind: "double_claim"; severity: "warning"; medicationId: string; time: string };

export type NotGuidedReason = "as_needed" | "over_the_counter" | "interval" | "paused" | "no_times";

export interface OrganizerPlan {
  id: string;
  memberId: string;
  scheduleKind: OrganizerScheduleKind;
  everyN: number | null;
  monthlyDay: number | null;
  anchorDate: string;
  fillLengthDays: number;
  /** "HH:MM" */
  reminderTime: string;
  version: number;
  compartments: OrganizerCompartment[];
  /** Dose time "HH:MM" to compartment id. */
  timeMap: Record<string, string>;
  caregiverMemberIds: string[];
  setup: {
    /** Every dose time that occurs in the next fill length. */
    doseTimes: string[];
    problems: SetupProblem[];
    notGuided: Array<{ medicationId: string; reason: NotGuidedReason }>;
    /** No errors and at least one dose to place. */
    ready: boolean;
  };
  canEdit: boolean;
}

/** The steps of the setup sheet, in order. */
export const ORGANIZER_STEPS = ["schedule", "compartments", "times", "quantities", "people"] as const;
export type OrganizerStep = (typeof ORGANIZER_STEPS)[number];

export const ORGANIZER_STEP_LABELS: Record<OrganizerStep, string> = {
  schedule: "Schedule",
  compartments: "Compartments",
  times: "Times",
  quantities: "Pills",
  people: "People",
};
