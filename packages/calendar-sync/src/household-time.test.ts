import { describe, expect, it } from "vitest";
import {
  classifyDueReminder,
  addDaysIso,
  monFriWeekRange,
  mondayOfWeekIso,
  weeksOverlappingRange,
  OVERDUE_REMINDER_COOLDOWN_MS,
} from "./household-time.js";
import { normalizeReminderOffsets } from "./event-reminders.js";

describe("classifyDueReminder", () => {
  const tz = "UTC";
  const today = "2026-06-18";

  it("fires due_tomorrow once per local day", () => {
    expect(
      classifyDueReminder({
        dueDate: addDaysIso(today, 1),
        today,
        lastSentAt: null,
        now: new Date(`${today}T12:00:00Z`),
        timeZone: tz,
      }),
    ).toBe("due_tomorrow");
  });

  it("fires due_today after tomorrow notice on due date", () => {
    const yesterday = addDaysIso(today, -1);
    expect(
      classifyDueReminder({
        dueDate: today,
        today,
        lastSentAt: new Date(`${yesterday}T12:00:00Z`),
        now: new Date(`${today}T08:00:00Z`),
        timeZone: tz,
      }),
    ).toBe("due_today");
  });

  it("re-fires overdue after cooldown", () => {
    const due = addDaysIso(today, -2);
    const lastSent = new Date(Date.now() - OVERDUE_REMINDER_COOLDOWN_MS - 1000);
    expect(
      classifyDueReminder({
        dueDate: due,
        today,
        lastSentAt: lastSent,
        now: new Date(),
        timeZone: tz,
      }),
    ).toBe("overdue");
  });

  it("skips overdue inside cooldown", () => {
    const due = addDaysIso(today, -2);
    expect(
      classifyDueReminder({
        dueDate: due,
        today,
        lastSentAt: new Date(),
        now: new Date(),
        timeZone: tz,
      }),
    ).toBeNull();
  });
});

describe("monFriWeekRange", () => {
  it("returns Mon–Fri for a Wednesday reference date", () => {
    const range = monFriWeekRange({ timeZone: "UTC", referenceDate: "2026-06-18" });
    expect(mondayOfWeekIso("2026-06-18")).toBe("2026-06-15");
    expect(range.weekStart).toBe("2026-06-15");
    expect(range.weekEnd).toBe("2026-06-19");
    expect(range.weekLabel).toContain("Jun");
  });
});

describe("weeksOverlappingRange", () => {
  it("lists each Mon–Fri week overlapping a span", () => {
    const weeks = weeksOverlappingRange("2026-06-10", "2026-06-25", "UTC");
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-06-08", "2026-06-15", "2026-06-22"]);
  });

  it("returns empty when from is after to", () => {
    expect(weeksOverlappingRange("2026-06-20", "2026-06-01", "UTC")).toEqual([]);
  });
});

describe("normalizeReminderOffsets expanded", () => {
  it("accepts custom minutes up to one week", () => {
    expect(normalizeReminderOffsets([5, 180, 10080])).toEqual([5, 180, 10080]);
  });

  it("rejects out of range", () => {
    expect(normalizeReminderOffsets([0, 20000])).toEqual([]);
  });
});
