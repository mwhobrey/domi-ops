import { describe, expect, it } from "vitest";
import {
  OVERDUE_NUDGE_AFTER_MINUTES,
  buildCheckReminderCopy,
  buildCheckReminderDeepLink,
  planCheckReminders,
} from "./health-check-reminder-scan.js";
import { intervalCheckSlots } from "./health-check-slots.js";
import { LOOKBACK_MS, WINDOW_MS, parseReminderOffsets } from "./health-reminder-shared.js";
import { parseIntervalSchedule } from "./med-interval-schedule.js";

const MIN = 60_000;
const now = new Date("2026-10-02T17:00:00.000Z");
const at = (minutesFromNow: number) => new Date(now.getTime() + minutesFromNow * MIN);
const plan = (minutesFromNow: number, status: Parameters<typeof planCheckReminders>[0]["slot"]["status"], offsets = [0]) =>
  planCheckReminders({ slot: { scheduledAt: at(minutesFromNow), status }, offsets, now });

describe("scan window", () => {
  it("looks 6 minutes ahead and 30 back, like the medication scan", () => {
    expect(WINDOW_MS).toBe(6 * MIN);
    expect(LOOKBACK_MS).toBe(30 * MIN);
    expect(OVERDUE_NUDGE_AFTER_MINUTES).toBe(30);
  });
});

describe("planCheckReminders: upcoming and due slots", () => {
  it("reminds for a slot a few minutes away", () => {
    expect(plan(5, "upcoming")).toEqual([{ offsetMinutes: 0, kind: "upcoming" }]);
    expect(plan(3, "upcoming")).toEqual([{ offsetMinutes: 0, kind: "upcoming" }]);
  });

  it("says it is due once the slot has arrived", () => {
    expect(plan(0, "due")).toEqual([{ offsetMinutes: 0, kind: "due" }]);
    expect(plan(-10, "due")).toEqual([{ offsetMinutes: 0, kind: "due" }]);
  });

  it("waits until the slot is within the look-ahead window (inclusive edge)", () => {
    expect(plan(7, "upcoming")).toEqual([]);
    expect(plan(6, "upcoming")).toEqual([{ offsetMinutes: 0, kind: "upcoming" }]);
    expect(planCheckReminders({ slot: { scheduledAt: new Date(now.getTime() + WINDOW_MS + 1), status: "upcoming" }, offsets: [0], now })).toEqual([]);
  });

  it("still sends a reminder a late scan missed, but not one that is too old", () => {
    expect(plan(-30, "due")).toEqual([{ offsetMinutes: 0, kind: "due" }]);
    expect(plan(-31, "due")).toEqual([]);
  });

  it("sends each configured offset once its own time comes", () => {
    // Slot is 15 minutes out: the 15-minute-early reminder is due now, the on-time one is not yet.
    expect(plan(15, "upcoming", [0, 15])).toEqual([{ offsetMinutes: 15, kind: "upcoming" }]);
    // A few minutes before the slot the on-time one is due and the early one is still in the lookback.
    expect(plan(3, "upcoming", [0, 15]).map((p) => p.offsetMinutes).sort((a, b) => a - b)).toEqual([0, 15]);
    // Ignores a repeated offset.
    expect(plan(3, "upcoming", [0, 0, 0])).toHaveLength(1);
  });
});

describe("planCheckReminders: the overdue nudge", () => {
  it("sends one nudge when the slot turns overdue, tracked under a negative offset", () => {
    expect(plan(-30, "overdue")).toEqual([{ offsetMinutes: -30, kind: "overdue" }]);
    expect(plan(-45, "overdue")).toEqual([{ offsetMinutes: -30, kind: "overdue" }]);
    expect(plan(-59, "overdue")).toEqual([{ offsetMinutes: -30, kind: "overdue" }]);
  });

  it("stops nudging once it is too old", () => {
    expect(plan(-61, "overdue")).toEqual([]);
    expect(plan(-240, "overdue")).toEqual([]);
  });

  it("is the only thing an overdue slot gets, even with offsets configured", () => {
    expect(plan(-35, "overdue", [0, 15, 60])).toEqual([{ offsetMinutes: -30, kind: "overdue" }]);
  });

  it("never collides with a person-chosen offset, which is never negative", () => {
    expect(parseReminderOffsets("[0, 15, -30, 60]")).toEqual([0, 15, 60]);
    expect(parseReminderOffsets(null)).toEqual([0]);
    expect(parseReminderOffsets("nope")).toEqual([0]);
  });
});

describe("planCheckReminders: answered slots", () => {
  it("sends nothing for a slot that is done, skipped or missed", () => {
    for (const status of ["done", "skipped", "missed"] as const) {
      expect(plan(3, status), status).toEqual([]);
      expect(plan(-5, status), status).toEqual([]);
      expect(plan(-40, status), status).toEqual([]);
    }
  });
});

describe("buildCheckReminderCopy", () => {
  const scheduledAt = new Date("2026-10-02T17:00:00.000Z"); // 12:00 PM in Chicago (CDT)
  const base = { checkName: "Ally BP", scheduledAt, timeZone: "America/Chicago", subjectLabel: "Ally", now: new Date("2026-10-02T16:55:00.000Z") };

  it("tells the person what is due, in their own time zone", () => {
    expect(buildCheckReminderCopy({ ...base, kind: "upcoming", isSubject: true })).toEqual({
      title: "Health check • 12:00 PM",
      body: "Ally BP at 12:00 PM",
    });
    expect(buildCheckReminderCopy({ ...base, kind: "due", isSubject: true })).toEqual({
      title: "Health check • 12:00 PM",
      body: "Time to check Ally BP at 12:00 PM",
    });
    expect(buildCheckReminderCopy({ ...base, kind: "overdue", isSubject: true })).toEqual({
      title: "Health check overdue • 12:00 PM",
      body: "Ally BP at 12:00 PM hasn't been logged yet",
    });
  });

  it("names whose check it is for a caregiver", () => {
    expect(buildCheckReminderCopy({ ...base, kind: "due", isSubject: false }).body).toBe("Ally — Time to check Ally BP at 12:00 PM");
    expect(buildCheckReminderCopy({ ...base, kind: "overdue", isSubject: false }).body).toBe("Ally — Ally BP at 12:00 PM hasn't been logged yet");
  });

  it("reads the same slot in another device's time zone", () => {
    const ny = buildCheckReminderCopy({ ...base, kind: "due", isSubject: true, timeZone: "America/New_York" });
    expect(ny.title).toBe("Health check • 1:00 PM");
  });

  it("adds the date for another day", () => {
    const copy = buildCheckReminderCopy({ ...base, kind: "upcoming", isSubject: true, now: new Date("2026-10-01T20:00:00.000Z") });
    expect(copy.body).toBe("Ally BP at Oct 2, 12:00 PM");
  });
});

describe("buildCheckReminderDeepLink", () => {
  it("opens the health page on the check and slot", () => {
    expect(buildCheckReminderDeepLink({ checkId: "abc", scheduledAt: new Date("2026-10-02T17:00:00.000Z") })).toBe(
      "/health?check=abc&scheduledAt=2026-10-02T17%3A00%3A00.000Z",
    );
  });
});

describe("intervalCheckSlots and the first-reading slot", () => {
  const first = parseIntervalSchedule(
    JSON.stringify({ everyMinutes: 240, anchor: "first_taken", intervalFrom: "last_taken", stop: { mode: "midnight" } }),
  )!;
  const base = { schedule: first, dates: ["2026-10-02"], today: "2026-10-02", now, timeZone: "UTC", logs: [] };

  it("offers the start slot by default (for a Start button) but not to a reminder", () => {
    expect(intervalCheckSlots(base)).toHaveLength(1);
    expect(intervalCheckSlots({ ...base, includeAwaitingFirst: false })).toEqual([]);
  });
});
