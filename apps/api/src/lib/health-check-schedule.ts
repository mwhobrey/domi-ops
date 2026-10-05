import { isAsNeededMedScheduleKind, narrowGroupScheduleMeta } from "@domi-ops/db";
import { normalizeMedSchedule } from "./health-serialize.js";

export type CheckScheduleErrorCode =
  | "check_schedule_must_be_scheduled_or_interval"
  | "scheduled_checks_require_times"
  | "invalid_time"
  | "too_many_times"
  | "invalid_schedule";

/**
 * Most times one check or group can have in a day. Every time is expanded for every day the worker
 * and the calendar look at, so an unbounded list is a way to make those slow; a real schedule
 * (hourly, say) is far below this.
 */
export const MAX_CHECK_TIMES = 48;

/** `HH:MM`, optionally `:SS`, on a 24 hour clock. */
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Most reminders per time, and the furthest ahead one may be set (a week, in minutes). */
export const MAX_REMINDER_OFFSETS = 10;
export const MAX_REMINDER_OFFSET_MINUTES = 7 * 24 * 60;

/**
 * Minutes-before offsets for a check or group: whole numbers from 0 to a week, no repeats,
 * ascending, at most {@link MAX_REMINDER_OFFSETS}. Anything else in the list is dropped. Not a list
 * means one reminder at the time itself; an empty list is kept (no reminders).
 */
export function normalizeReminderOffsets(value: unknown): number[] {
  if (!Array.isArray(value)) return [0];
  const kept = value.filter(
    (n): n is number =>
      typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_REMINDER_OFFSET_MINUTES,
  );
  return [...new Set(kept)].sort((a, b) => a - b).slice(0, MAX_REMINDER_OFFSETS);
}

/** Strict clock times, de-duplicated and in order; throws on anything that is not one. */
function normalizeClockTimes(times: unknown): string[] {
  if (!Array.isArray(times)) return [];
  const seen = new Set<string>();
  for (const t of times) {
    if (typeof t !== "string" || !CLOCK_TIME.test(t.trim())) throw new CheckScheduleError("invalid_time");
    seen.add(t.trim().slice(0, 5));
  }
  if (seen.size > MAX_CHECK_TIMES) throw new CheckScheduleError("too_many_times");
  return [...seen].sort();
}

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
  // Times are checked here, before the shared medication code, which only looks for a colon.
  const isInterval = input.scheduleKind === "interval";
  const input2: CheckScheduleInput = isInterval
    ? input
    : {
        ...input,
        schedule: { ...input.schedule, times: normalizeClockTimes(input.schedule?.times) },
      };
  let normalized: ReturnType<typeof normalizeMedSchedule>;
  try {
    normalized = normalizeMedSchedule(input2);
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
