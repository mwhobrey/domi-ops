import { describe, expect, it } from "vitest";
import { calendarSetupComplete } from "./CalendarSetupBanner";

describe("calendarSetupComplete", () => {
  it("treats local/HomeHub calendars as complete without Google OAuth", () => {
    expect(
      calendarSetupComplete({ connected: false, hasCalendars: true, needsImport: false }),
    ).toBe(true);
  });

  it("still incomplete when no calendars exist", () => {
    expect(
      calendarSetupComplete({ connected: false, hasCalendars: false, needsImport: false }),
    ).toBe(false);
  });

  it("still incomplete when Google import is pending", () => {
    expect(
      calendarSetupComplete({ connected: true, hasCalendars: true, needsImport: true }),
    ).toBe(false);
  });
});
