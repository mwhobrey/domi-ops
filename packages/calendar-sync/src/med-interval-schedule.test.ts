import { describe, expect, it } from "vitest";
import {
  normalizeIntervalSchedule,
  nextIntervalPending,
  parseIntervalSchedule,
} from "./med-interval-schedule.js";
import { zonedLocalToUtc } from "./household-time.js";

const tz = "America/Chicago";
const date = "2026-08-05";

describe("normalizeIntervalSchedule", () => {
  it("requires every + stop settings", () => {
    expect(() => normalizeIntervalSchedule({ everyMinutes: 180, stop: { mode: "max_doses", maxDoses: 5 } })).not.toThrow();
    expect(() => normalizeIntervalSchedule({ everyMinutes: 2 })).toThrow();
    expect(() =>
      normalizeIntervalSchedule({
        everyMinutes: 180,
        anchor: "fixed_start",
        stop: { mode: "max_doses", maxDoses: 4 },
      }),
    ).toThrow(/fixed_start/);
  });
});

describe("nextIntervalPending", () => {
  it("awaits first dose when anchor is first_taken", () => {
    const schedule = parseIntervalSchedule(
      JSON.stringify({
        everyMinutes: 180,
        anchor: "first_taken",
        intervalFrom: "last_taken",
        stop: { mode: "max_doses", maxDoses: 5 },
      }),
    )!;
    const now = zonedLocalToUtc(date, "07:12", tz);
    const pending = nextIntervalPending({ schedule, tz, date, now, logs: [] });
    expect(pending?.awaitingFirst).toBe(true);
    expect(pending?.scheduledTimeLabel).toBe("First dose");
  });

  it("schedules from last Taken + interval", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 180,
      anchor: "first_taken",
      intervalFrom: "last_taken",
      stop: { mode: "max_doses", maxDoses: 5 },
    });
    const takenAt = zonedLocalToUtc(date, "07:12", tz);
    const pending = nextIntervalPending({
      schedule,
      tz,
      date,
      now: zonedLocalToUtc(date, "08:00", tz),
      logs: [{ scheduledAt: takenAt, loggedAt: takenAt, status: "taken" }],
    });
    expect(pending?.awaitingFirst).toBe(false);
    expect(pending?.scheduledAt.toISOString()).toBe(
      zonedLocalToUtc(date, "10:12", tz).toISOString(),
    );
  });

  it("keeps fixed grid even if first taken is late", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 180,
      anchor: "fixed_start",
      fixedStartTime: "07:00",
      intervalFrom: "schedule_grid",
      stop: { mode: "max_doses", maxDoses: 4 },
    });
    const late = zonedLocalToUtc(date, "07:40", tz);
    const grid7 = zonedLocalToUtc(date, "07:00", tz);
    const pending = nextIntervalPending({
      schedule,
      tz,
      date,
      now: zonedLocalToUtc(date, "08:00", tz),
      logs: [{ scheduledAt: grid7, loggedAt: late, status: "taken" }],
    });
    expect(pending?.scheduledAt.toISOString()).toBe(
      zonedLocalToUtc(date, "10:00", tz).toISOString(),
    );
  });

  it("stops at max doses", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 180,
      anchor: "first_taken",
      intervalFrom: "last_taken",
      stop: { mode: "max_doses", maxDoses: 2 },
    });
    const t1 = zonedLocalToUtc(date, "07:00", tz);
    const t2 = zonedLocalToUtc(date, "10:00", tz);
    const pending = nextIntervalPending({
      schedule,
      tz,
      date,
      now: zonedLocalToUtc(date, "11:00", tz),
      logs: [
        { scheduledAt: t1, loggedAt: t1, status: "taken" },
        { scheduledAt: t2, loggedAt: t2, status: "taken" },
      ],
    });
    expect(pending).toBeNull();
  });
});
