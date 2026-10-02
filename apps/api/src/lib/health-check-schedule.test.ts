import { describe, expect, it } from "vitest";
import { CheckScheduleError, normalizeCheckSchedule } from "./health-check-schedule.js";

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
    expect(codeOf(() => normalizeCheckSchedule({ schedule: { times: ["nope"] } }))).toBe(
      "scheduled_checks_require_times",
    );
  });

  it("surfaces interval validation errors as invalid_schedule", () => {
    expect(codeOf(() => normalizeCheckSchedule({ scheduleKind: "interval", schedule: { everyMinutes: 2 } }))).toBe(
      "invalid_schedule",
    );
  });
});
