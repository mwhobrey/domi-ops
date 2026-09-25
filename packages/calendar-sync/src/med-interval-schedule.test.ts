import { describe, expect, it } from "vitest";
import {
  intervalSlotShiftsForEdit,
  normalizeIntervalSchedule,
  nextIntervalPending,
  parseIntervalSchedule,
  type IntervalEditLog,
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

describe("intervalSlotShiftsForEdit", () => {
  const at = (hhmm: string, day = date) => zonedLocalToUtc(day, hhmm, tz);
  const taken = (id: string, scheduled: Date, logged = scheduled): IntervalEditLog => ({
    id,
    scheduledAt: scheduled,
    loggedAt: logged,
    status: "taken",
  });
  /** Apply the edit (new loggedAt + shifts) the way the API route does. */
  function applyEdit(logs: IntervalEditLog[], logId: string, newLoggedAt: Date, shifts: { id: string; scheduledAt: Date }[]) {
    const byId = new Map(shifts.map((s) => [s.id, s.scheduledAt]));
    return logs.map((l) => ({
      ...l,
      loggedAt: l.id === logId ? newLoggedAt : l.loggedAt,
      scheduledAt: byId.get(l.id) ?? l.scheduledAt,
    }));
  }

  it("last_taken: a late-logged first dose moves the next dose to edited time + interval", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 180,
      anchor: "first_taken",
      intervalFrom: "last_taken",
      stop: { mode: "max_doses", maxDoses: 5 },
    });
    // Tapped Start at 11:04 but actually took it at 07:00.
    const logs = [taken("a", new Date(at("11:04").getTime() + 17_000), at("11:04"))];
    const shifts = intervalSlotShiftsForEdit({ schedule, tz, logs, logId: "a", newLoggedAt: at("07:00") });
    expect(shifts).toEqual([{ id: "a", scheduledAt: at("07:00") }]);
    const pending = nextIntervalPending({
      schedule,
      tz,
      date,
      now: at("11:10"),
      logs: applyEdit(logs, "a", at("07:00"), shifts),
    });
    expect(pending?.scheduledAt.toISOString()).toBe(at("10:00").toISOString());
  });

  it("schedule_grid + first_taken: moving the first dose shifts the logged slots with it", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 240,
      anchor: "first_taken",
      intervalFrom: "schedule_grid",
      stop: { mode: "max_doses", maxDoses: 4 },
    });
    const logs = [taken("first", at("10:00")), taken("second", at("14:00"), at("14:20"))];
    const shifts = intervalSlotShiftsForEdit({ schedule, tz, logs, logId: "first", newLoggedAt: at("09:00") });
    expect(shifts).toEqual([
      { id: "first", scheduledAt: at("09:00") },
      { id: "second", scheduledAt: at("13:00") },
    ]);
    const pending = nextIntervalPending({
      schedule,
      tz,
      date,
      now: at("15:00"),
      logs: applyEdit(logs, "first", at("09:00"), shifts),
    });
    // 13:00 is covered by the shifted second dose; without the shift it would come back overdue.
    expect(pending?.scheduledAt.toISOString()).toBe(at("17:00").toISOString());
  });

  it("schedule_grid: editing a later dose leaves the grid alone", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 240,
      anchor: "first_taken",
      intervalFrom: "schedule_grid",
      stop: { mode: "max_doses", maxDoses: 4 },
    });
    const logs = [taken("first", at("10:00")), taken("second", at("14:00"), at("14:20"))];
    expect(
      intervalSlotShiftsForEdit({ schedule, tz, logs, logId: "second", newLoggedAt: at("14:05") }),
    ).toEqual([]);
  });

  it("fixed_start grid: nothing moves", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 180,
      anchor: "fixed_start",
      fixedStartTime: "07:00",
      intervalFrom: "schedule_grid",
      stop: { mode: "max_doses", maxDoses: 4 },
    });
    const logs = [taken("first", at("07:00"), at("07:40"))];
    expect(
      intervalSlotShiftsForEdit({ schedule, tz, logs, logId: "first", newLoggedAt: at("07:10") }),
    ).toEqual([]);
  });

  it("multi-day grid: moving the origin shifts later days' slots", () => {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: 48 * 60,
      anchor: "first_taken",
      intervalFrom: "schedule_grid",
      stop: { mode: "midnight" },
    });
    const logs = [taken("first", at("09:00")), taken("second", at("09:00", "2026-08-07"))];
    const shifts = intervalSlotShiftsForEdit({ schedule, tz, logs, logId: "first", newLoggedAt: at("08:00") });
    expect(shifts).toEqual([
      { id: "first", scheduledAt: at("08:00") },
      { id: "second", scheduledAt: at("08:00", "2026-08-07") },
    ]);
  });
});
