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

  it("does not re-show every day for once-every-7-days after a take", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 7 * 24 * 60,
      anchor: "first_taken",
      intervalFrom: "last_taken",
      stop: { mode: "max_doses", maxDoses: 1 },
    });
    const takenDay = "2026-08-05";
    const takenAt = zonedLocalToUtc(takenDay, "08:00", tz);
    const dayAfter = "2026-08-06";
    const midWeek = "2026-08-10";
    const dueDay = "2026-08-12";

    expect(
      nextIntervalPending({
        schedule,
        tz,
        date: dayAfter,
        now: zonedLocalToUtc(dayAfter, "08:00", tz),
        logs: [{ scheduledAt: takenAt, loggedAt: takenAt, status: "taken" }],
      }),
    ).toBeNull();

    expect(
      nextIntervalPending({
        schedule,
        tz,
        date: midWeek,
        now: zonedLocalToUtc(midWeek, "08:00", tz),
        logs: [{ scheduledAt: takenAt, loggedAt: takenAt, status: "taken" }],
      }),
    ).toBeNull();

    const due = nextIntervalPending({
      schedule,
      tz,
      date: dueDay,
      now: zonedLocalToUtc(dueDay, "07:30", tz),
      logs: [{ scheduledAt: takenAt, loggedAt: takenAt, status: "taken" }],
    });
    expect(due?.awaitingFirst).toBe(false);
    expect(due?.scheduledAt.toISOString()).toBe(
      zonedLocalToUtc(dueDay, "08:00", tz).toISOString(),
    );
  });

  it("does not re-show fixed_start every morning for multi-day interval", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 7 * 24 * 60,
      anchor: "fixed_start",
      fixedStartTime: "08:00",
      intervalFrom: "last_taken",
      stop: { mode: "max_doses", maxDoses: 1 },
    });
    const takenDay = "2026-08-05";
    const takenAt = zonedLocalToUtc(takenDay, "08:05", tz);
    const dayAfter = "2026-08-06";

    expect(
      nextIntervalPending({
        schedule,
        tz,
        date: dayAfter,
        now: zonedLocalToUtc(dayAfter, "09:00", tz),
        logs: [{ scheduledAt: zonedLocalToUtc(takenDay, "08:00", tz), loggedAt: takenAt, status: "taken" }],
      }),
    ).toBeNull();
  });
});
