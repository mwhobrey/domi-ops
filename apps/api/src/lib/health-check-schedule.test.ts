import { describe, expect, it } from "vitest";
import {
  CheckScheduleError,
  MAX_CHECK_TIMES,
  MAX_REMINDER_OFFSETS,
  MAX_REMINDER_OFFSET_MINUTES,
  normalizeCheckSchedule,
  normalizeReminderOffsets,
} from "./health-check-schedule.js";

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof CheckScheduleError ? e.code : "other";
  }
}

describe("normalizeCheckSchedule", () => {
  it("accepts four times a day, the way a BP check is scheduled", () => {
    const out = normalizeCheckSchedule({
      scheduleKind: "scheduled",
      schedule: { times: ["08:00", "12:00", "16:00", "20:00"] },
    });
    expect(out.scheduleKind).toBe("scheduled");
    expect(JSON.parse(out.scheduleJson)).toEqual({ times: ["08:00", "12:00", "16:00", "20:00"] });
  });

  it("defaults to scheduled and keeps weekdays", () => {
    const out = normalizeCheckSchedule({ schedule: { times: ["09:00"], daysOfWeek: [1, 3, 5, 9, -1] } });
    expect(out.scheduleKind).toBe("scheduled");
    expect(JSON.parse(out.scheduleJson)).toEqual({ times: ["09:00"], daysOfWeek: [1, 3, 5] });
  });

  it("accepts an interval schedule", () => {
    const out = normalizeCheckSchedule({
      scheduleKind: "interval",
      schedule: { everyMinutes: 240, anchor: "first_taken", stop: { mode: "midnight" } },
    });
    expect(out.scheduleKind).toBe("interval");
    expect(JSON.parse(out.scheduleJson).everyMinutes).toBe(240);
  });

  it("rejects as-needed kinds: there is no due time to remind about", () => {
    expect(codeOf(() => normalizeCheckSchedule({ scheduleKind: "prn" }))).toBe(
      "check_schedule_must_be_scheduled_or_interval",
    );
    expect(codeOf(() => normalizeCheckSchedule({ scheduleKind: "otc" }))).toBe(
      "check_schedule_must_be_scheduled_or_interval",
    );
  });

  it("requires at least one time for a scheduled check, with a check-flavoured code", () => {
    expect(codeOf(() => normalizeCheckSchedule({ scheduleKind: "scheduled", schedule: { times: [] } }))).toBe(
      "scheduled_checks_require_times",
    );
    expect(codeOf(() => normalizeCheckSchedule({}))).toBe("scheduled_checks_require_times");
    // Something that isn't a time is named as that, rather than looking like a missing list.
    expect(codeOf(() => normalizeCheckSchedule({ schedule: { times: ["nope"] } }))).toBe("invalid_time");
  });

  it("surfaces interval validation errors as invalid_schedule", () => {
    expect(codeOf(() => normalizeCheckSchedule({ scheduleKind: "interval", schedule: { everyMinutes: 2 } }))).toBe(
      "invalid_schedule",
    );
  });
});

describe("times on a scheduled check", () => {
  const scheduled = (times: unknown) =>
    normalizeCheckSchedule({ scheduleKind: "scheduled", schedule: { times: times as string[] } });
  const timesOf = (times: unknown) => JSON.parse(scheduled(times).scheduleJson).times;

  it("must be real clock times, not just anything with a colon", () => {
    for (const bad of ["24:00", "99:99", "8:00", "08:60", "ab:cd", "08:00pm", ":", "08:00:99", ""]) {
      expect(codeOf(() => scheduled([bad])), bad).toBe("invalid_time");
    }
    expect(codeOf(() => scheduled(["08:00", 5 as unknown as string]))).toBe("invalid_time");
  });

  it("takes HH:MM with or without seconds, drops repeats and puts them in order", () => {
    expect(timesOf(["20:00", "08:00:30", "08:00", "12:15"])).toEqual(["08:00", "12:15", "20:00"]);
  });

  it("stops at a day's worth of half hours", () => {
    const halfHours = Array.from({ length: MAX_CHECK_TIMES }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
    expect(timesOf(halfHours)).toHaveLength(MAX_CHECK_TIMES);
    expect(codeOf(() => scheduled([...halfHours, "23:59"]))).toBe("too_many_times");
  });

  it("repeats don't count towards the limit", () => {
    expect(timesOf(Array.from({ length: 500 }, () => "08:00"))).toEqual(["08:00"]);
  });

  it("still needs at least one", () => {
    expect(codeOf(() => scheduled([]))).toBe("scheduled_checks_require_times");
  });

  it("leaves an interval schedule alone", () => {
    expect(
      normalizeCheckSchedule({ scheduleKind: "interval", schedule: { everyMinutes: 240, anchor: "first_taken", stop: { mode: "midnight" } } })
        .scheduleKind,
    ).toBe("interval");
  });
});

describe("normalizeReminderOffsets", () => {
  it("keeps whole minutes up to a week, ascending, without repeats", () => {
    expect(normalizeReminderOffsets([30, 0, 15, 15, MAX_REMINDER_OFFSET_MINUTES])).toEqual([0, 15, 30, MAX_REMINDER_OFFSET_MINUTES]);
  });

  it("drops what isn't usable: fractions, negatives, too far ahead, not numbers", () => {
    expect(normalizeReminderOffsets([1.5, -1, MAX_REMINDER_OFFSET_MINUTES + 1, 1e300, "5", null, NaN, Infinity, 10])).toEqual([10]);
  });

  it("caps how many reminders one time can have", () => {
    const many = Array.from({ length: 200 }, (_, i) => i);
    expect(normalizeReminderOffsets(many)).toEqual(many.slice(0, MAX_REMINDER_OFFSETS));
  });

  it("means one reminder at the time when it isn't a list, and none for an empty list", () => {
    expect(normalizeReminderOffsets(undefined)).toEqual([0]);
    expect(normalizeReminderOffsets("15")).toEqual([0]);
    expect(normalizeReminderOffsets([])).toEqual([]);
  });
});
