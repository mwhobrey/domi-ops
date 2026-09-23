import { describe, expect, it } from "vitest";
import { calendarReminderBody } from "./push-calendar.js";

describe("calendarReminderBody", () => {
  it("pluralizes hours and minutes properly", () => {
    expect(calendarReminderBody("Munch", 180)).toBe("Munch starts in 3 hours");
    expect(calendarReminderBody("Munch", 60)).toBe("Munch starts in 1 hour");
    expect(calendarReminderBody("Munch", 90)).toBe("Munch starts in 1 hour 30 minutes");
    expect(calendarReminderBody("Psych", 35)).toBe("Psych starts in 35 minutes");
    expect(calendarReminderBody("Psych", 1)).toBe("Psych starts in 1 minute");
    expect(calendarReminderBody("Trip", 1440)).toBe("Trip starts tomorrow");
  });
});
