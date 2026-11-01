import { describe, expect, it } from "vitest";
import { doseLogLookbackDays } from "./health-med-logging.js";

function intervalScheduleJson(everyDays: number): string {
  return JSON.stringify({
    everyMinutes: everyDays * 24 * 60,
    anchor: "first_taken",
    intervalFrom: "last_taken",
    stop: { mode: "max_doses", maxDoses: 1 },
  });
}

describe("doseLogLookbackDays", () => {
  it("keeps the 60-day floor for empty, short, and non-interval schedules", () => {
    expect(doseLogLookbackDays([])).toBe(60);
    expect(doseLogLookbackDays([intervalScheduleJson(7)])).toBe(60);
    expect(doseLogLookbackDays(['{"times":["08:00"],"daysOfWeek":[1]}'])).toBe(60);
    expect(doseLogLookbackDays(["not json", null, undefined])).toBe(60);
  });

  it("widens to interval length plus one day for long schedules", () => {
    expect(doseLogLookbackDays([intervalScheduleJson(90)])).toBe(91);
    expect(doseLogLookbackDays([intervalScheduleJson(365)])).toBe(366);
  });

  it("uses the maximum interval across multiple schedules", () => {
    expect(
      doseLogLookbackDays([
        intervalScheduleJson(90),
        intervalScheduleJson(120),
        intervalScheduleJson(365),
      ]),
    ).toBe(366);
  });
});
