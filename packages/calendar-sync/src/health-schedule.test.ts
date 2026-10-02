import { describe, expect, it } from "vitest";
import { addDaysIso, zonedLocalToUtc } from "./household-time.js";
import {
  expandScheduledSlots,
  parseFixedTimeSchedule,
  scheduleHhmm,
  type FixedTimeSchedule,
} from "./health-schedule.js";

/**
 * Verbatim copy of the loop that used to be inlined in health-med-reminder-scan.ts and
 * calendar-overlays.ts (four copies). The new shared function must agree with it exactly, so the
 * refactor cannot change when a medication reminder or overlay fires.
 */
function legacyExpand(params: {
  schedule: FixedTimeSchedule;
  startDate?: string | null;
  endDate?: string | null;
  dates: string[];
  tz: string;
  claimed?: Set<string>;
}) {
  const out: { date: string; hhmm: string; iso: string }[] = [];
  const times = params.schedule.times ?? [];
  for (const date of params.dates) {
    if (params.startDate && date < params.startDate) continue;
    if (params.endDate && date > params.endDate) continue;
    if (params.schedule.daysOfWeek?.length) {
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (!params.schedule.daysOfWeek.includes(dow)) continue;
    }
    for (const time of times) {
      const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
      if (params.claimed?.has(hhmm)) continue;
      out.push({ date, hhmm, iso: zonedLocalToUtc(date, hhmm, params.tz).toISOString() });
    }
  }
  return out;
}

function range(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDaysIso(from, i));
}

function viaShared(params: Parameters<typeof legacyExpand>[0]) {
  return expandScheduledSlots({
    times: params.schedule.times,
    daysOfWeek: params.schedule.daysOfWeek,
    startDate: params.startDate,
    endDate: params.endDate,
    dates: params.dates,
    timeZone: params.tz,
    skipHhmm: params.claimed,
  }).map((s) => ({ date: s.date, hhmm: s.hhmm, iso: s.scheduledAt.toISOString() }));
}

describe("expandScheduledSlots", () => {
  it("returns four BP-style slots for a plain daily schedule", () => {
    const slots = expandScheduledSlots({
      times: ["08:00", "12:00", "16:00", "20:00"],
      dates: ["2026-08-05"],
      timeZone: "America/Chicago",
    });
    expect(slots.map((s) => s.hhmm)).toEqual(["08:00", "12:00", "16:00", "20:00"]);
    expect(slots[0]!.scheduledAt.toISOString()).toBe("2026-08-05T13:00:00.000Z"); // CDT = UTC-5
    expect(slots.every((s) => s.date === "2026-08-05")).toBe(true);
  });

  it("is date-major, then in listed time order (not sorted)", () => {
    const slots = expandScheduledSlots({
      times: ["20:00", "08:00"],
      dates: ["2026-08-05", "2026-08-06"],
      timeZone: "UTC",
    });
    expect(slots.map((s) => `${s.date} ${s.hhmm}`)).toEqual([
      "2026-08-05 20:00",
      "2026-08-05 08:00",
      "2026-08-06 20:00",
      "2026-08-06 08:00",
    ]);
  });

  it("trims HH:MM:SS to HH:MM", () => {
    expect(scheduleHhmm("08:30:00")).toBe("08:30");
    expect(scheduleHhmm("8:5")).toBe("8:5");
    const [slot] = expandScheduledSlots({ times: ["08:30:00"], dates: ["2026-08-05"], timeZone: "UTC" });
    expect(slot!.hhmm).toBe("08:30");
  });

  it("honors inclusive start and end dates", () => {
    const slots = expandScheduledSlots({
      times: ["09:00"],
      startDate: "2026-08-06",
      endDate: "2026-08-07",
      dates: range("2026-08-05", 5),
      timeZone: "UTC",
    });
    expect(slots.map((s) => s.date)).toEqual(["2026-08-06", "2026-08-07"]);
  });

  it("filters weekdays (0 = Sunday) and treats an empty list as every day", () => {
    const week = range("2026-08-02", 7); // Sun 2026-08-02 .. Sat 2026-08-08
    const monWed = expandScheduledSlots({ times: ["09:00"], daysOfWeek: [1, 3], dates: week, timeZone: "UTC" });
    expect(monWed.map((s) => s.date)).toEqual(["2026-08-03", "2026-08-05"]);
    const none = expandScheduledSlots({ times: ["09:00"], daysOfWeek: [], dates: week, timeZone: "UTC" });
    expect(none).toHaveLength(7);
  });

  it("drops skipped times and yields nothing for an empty or missing time list", () => {
    const skipped = expandScheduledSlots({
      times: ["08:00", "20:00"],
      dates: ["2026-08-05"],
      timeZone: "UTC",
      skipHhmm: new Set(["08:00"]),
    });
    expect(skipped.map((s) => s.hhmm)).toEqual(["20:00"]);
    expect(expandScheduledSlots({ times: [], dates: ["2026-08-05"], timeZone: "UTC" })).toEqual([]);
    expect(expandScheduledSlots({ dates: ["2026-08-05"], timeZone: "UTC" })).toEqual([]);
  });

  it("keeps the local wall time across a DST change (spring forward and fall back)", () => {
    // America/Chicago: DST starts 2026-03-08, ends 2026-11-01.
    const spring = expandScheduledSlots({
      times: ["12:00"],
      dates: ["2026-03-07", "2026-03-08", "2026-03-09"],
      timeZone: "America/Chicago",
    });
    expect(spring.map((s) => s.scheduledAt.toISOString())).toEqual([
      "2026-03-07T18:00:00.000Z", // CST, UTC-6
      "2026-03-08T17:00:00.000Z", // CDT, UTC-5
      "2026-03-09T17:00:00.000Z",
    ]);
    const fall = expandScheduledSlots({
      times: ["12:00"],
      dates: ["2026-10-31", "2026-11-01", "2026-11-02"],
      timeZone: "America/Chicago",
    });
    expect(fall.map((s) => s.scheduledAt.toISOString())).toEqual([
      "2026-10-31T17:00:00.000Z", // CDT
      "2026-11-01T18:00:00.000Z", // CST
      "2026-11-02T18:00:00.000Z",
    ]);
  });

  it("uses the given timezone, so the same local time maps to different instants", () => {
    const chi = expandScheduledSlots({ times: ["08:00"], dates: ["2026-08-05"], timeZone: "America/Chicago" });
    const ny = expandScheduledSlots({ times: ["08:00"], dates: ["2026-08-05"], timeZone: "America/New_York" });
    expect(ny[0]!.scheduledAt.getTime()).toBeLessThan(chi[0]!.scheduledAt.getTime());
  });
});

describe("expandScheduledSlots matches the legacy inline loop", () => {
  const zones = ["UTC", "America/Chicago", "America/New_York", "Pacific/Auckland", "Asia/Kolkata"];
  const schedules: FixedTimeSchedule[] = [
    { times: ["08:00"] },
    { times: ["08:00", "12:00", "16:00", "20:00"] },
    { times: ["20:00:00", "06:30", "23:59"], daysOfWeek: [1, 3, 5] },
    { times: ["00:00", "12:00"], daysOfWeek: [0, 6] },
    { times: ["09:00"], daysOfWeek: [] },
    { times: [] },
    {},
  ];
  const windows = [
    range("2026-03-06", 6), // US spring-forward weekend
    range("2026-10-30", 6), // US fall-back weekend
    range("2026-09-25", 6), // NZ spring-forward (Sep 27)
    range("2026-12-30", 5), // year boundary
  ];
  const bounds: Array<[string | null, string | null]> = [
    [null, null],
    ["2026-03-08", null],
    [null, "2026-11-01"],
    ["2026-03-08", "2026-03-09"],
    ["2026-12-31", "2026-12-31"],
  ];

  it("agrees on every combination", () => {
    let combos = 0;
    for (const tz of zones) {
      for (const schedule of schedules) {
        for (const dates of windows) {
          for (const [startDate, endDate] of bounds) {
            for (const claimed of [undefined, new Set(["08:00", "20:00"])]) {
              const args = { schedule, startDate, endDate, dates, tz, claimed };
              expect(viaShared(args)).toEqual(legacyExpand(args));
              combos += 1;
            }
          }
        }
      }
    }
    expect(combos).toBeGreaterThan(1000);
  });
});

describe("parseFixedTimeSchedule", () => {
  it("parses times and weekdays", () => {
    expect(parseFixedTimeSchedule('{"times":["08:00","20:00"],"daysOfWeek":[1,2]}')).toEqual({
      times: ["08:00", "20:00"],
      daysOfWeek: [1, 2],
    });
  });

  it("omits daysOfWeek when absent and drops wrong-typed entries", () => {
    expect(parseFixedTimeSchedule('{"times":["08:00",5,null]}')).toEqual({
      times: ["08:00"],
      daysOfWeek: undefined,
    });
    expect(parseFixedTimeSchedule('{"times":["09:00"],"daysOfWeek":[1,"x",3]}').daysOfWeek).toEqual([1, 3]);
  });

  it("never throws on junk", () => {
    expect(parseFixedTimeSchedule(null)).toEqual({});
    expect(parseFixedTimeSchedule(undefined)).toEqual({});
    expect(parseFixedTimeSchedule("")).toEqual({});
    expect(parseFixedTimeSchedule("{nope")).toEqual({});
    expect(parseFixedTimeSchedule("null")).toEqual({});
    expect(parseFixedTimeSchedule('"str"')).toEqual({});
    expect(parseFixedTimeSchedule('{"times":"08:00"}')).toEqual({ times: [], daysOfWeek: undefined });
  });
});
