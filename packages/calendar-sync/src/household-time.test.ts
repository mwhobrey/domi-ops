import { describe, expect, it } from "vitest";
import {
  classifyDueReminder,
  addDaysIso,
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

describe("normalizeReminderOffsets expanded", () => {
  it("accepts custom minutes up to one week", () => {
    expect(normalizeReminderOffsets([5, 180, 10080])).toEqual([5, 180, 10080]);
  });

  it("rejects out of range", () => {
    expect(normalizeReminderOffsets([0, 20000])).toEqual([]);
  });
});
