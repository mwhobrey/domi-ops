import { zonedLocalToUtc } from "./household-time.js";

/**
 * Fixed-clock-time schedules ("scheduled" kind): `{ times: ["08:00", ...], daysOfWeek?: [0-6] }`
 * plus a start/end date on the owning row. Shared by medications and health checks so reminders,
 * calendar overlays and "is this slot due" all expand a schedule the same way. Interval schedules
 * have their own math in `med-interval-schedule.ts`.
 */
export type FixedTimeSchedule = { times?: string[]; daysOfWeek?: number[] };

/** "08:00:00" -> "08:00"; anything already shorter than 5 chars is returned as-is. */
export function scheduleHhmm(time: string): string {
  return time.length >= 5 ? time.slice(0, 5) : time;
}

/** Tolerant parse: malformed JSON or wrong-typed fields yield an empty schedule, never a throw. */
export function parseFixedTimeSchedule(raw: string | null | undefined): FixedTimeSchedule {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    return {
      times: Array.isArray(parsed.times)
        ? parsed.times.filter((t): t is string => typeof t === "string")
        : [],
      daysOfWeek: Array.isArray(parsed.daysOfWeek)
        ? parsed.daysOfWeek.filter((d): d is number => typeof d === "number")
        : undefined,
    };
  } catch {
    return {};
  }
}

export type ScheduledSlot = {
  /** Local calendar date (YYYY-MM-DD) in the expansion timezone. */
  date: string;
  /** Local wall-clock time, "HH:MM". */
  hhmm: string;
  /** The same instant as a UTC `Date`. */
  scheduledAt: Date;
};

/**
 * Expand a fixed-time schedule over `dates` (local ISO dates, in order) in `timeZone`.
 *
 * - dates before `startDate` or after `endDate` (inclusive bounds) produce nothing
 * - when `daysOfWeek` is non-empty, only those weekdays (0 = Sunday) produce slots
 * - slots come out date-major, then in the order the times are listed
 * - `skipHhmm` drops times (e.g. ones a group already covers) before any timezone work
 *
 * Pure: no I/O, no clock. Callers decide which dates to ask about.
 */
export function expandScheduledSlots(input: {
  times?: readonly string[] | null;
  daysOfWeek?: readonly number[] | null;
  startDate?: string | null;
  endDate?: string | null;
  dates: readonly string[];
  timeZone: string;
  skipHhmm?: ReadonlySet<string>;
}): ScheduledSlot[] {
  const times = input.times ?? [];
  const slots: ScheduledSlot[] = [];
  if (times.length === 0) return slots;

  for (const date of input.dates) {
    if (input.startDate && date < input.startDate) continue;
    if (input.endDate && date > input.endDate) continue;
    if (input.daysOfWeek?.length) {
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (!input.daysOfWeek.includes(dow)) continue;
    }
    for (const time of times) {
      const hhmm = scheduleHhmm(time);
      if (input.skipHhmm?.has(hhmm)) continue;
      slots.push({ date, hhmm, scheduledAt: zonedLocalToUtc(date, hhmm, input.timeZone) });
    }
  }
  return slots;
}
