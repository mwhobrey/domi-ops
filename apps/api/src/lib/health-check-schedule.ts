import { isAsNeededMedScheduleKind, narrowGroupScheduleMeta } from "@domi-ops/db";
import { normalizeMedSchedule } from "./health-serialize.js";

export type CheckScheduleErrorCode =
  | "check_schedule_must_be_scheduled_or_interval"
  | "scheduled_checks_require_times"
  | "invalid_schedule";

export class CheckScheduleError extends Error {
  constructor(public readonly code: CheckScheduleErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CheckScheduleError";
  }
}

export type CheckScheduleInput = {
  scheduleKind?: string;
  schedule?: {
    times?: string[];
    daysOfWeek?: number[];
    everyMinutes?: number;
    anchor?: string;
    fixedStartTime?: string;
    intervalFrom?: string;
    stop?: { mode?: string; maxDoses?: number; endTime?: string };
  };
};

/**
 * Schedules for checks and check groups: the same `scheduled` (clock times + weekdays) and
 * `interval` shapes as medications, validated by the same code. As-needed kinds (`prn`, `otc`)
 * have no due time to remind about, so they are rejected. Throws {@link CheckScheduleError}.
 */
export function normalizeCheckSchedule(input: CheckScheduleInput): {
  scheduleKind: "scheduled" | "interval";
  scheduleJson: string;
} {
  if (isAsNeededMedScheduleKind(input.scheduleKind)) {
    throw new CheckScheduleError("check_schedule_must_be_scheduled_or_interval");
  }
  let normalized: ReturnType<typeof normalizeMedSchedule>;
  try {
    normalized = normalizeMedSchedule(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // normalizeMedSchedule's wording is about meds; checks get their own code for the same rule.
    if (message === "scheduled_meds_require_times") throw new CheckScheduleError("scheduled_checks_require_times");
    throw new CheckScheduleError("invalid_schedule", message || "invalid_schedule");
  }
  const narrowed = narrowGroupScheduleMeta(normalized);
  if (!narrowed) throw new CheckScheduleError("check_schedule_must_be_scheduled_or_interval");
  return narrowed;
}
