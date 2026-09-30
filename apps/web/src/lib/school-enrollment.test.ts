import { describe, expect, it } from "vitest";
import { formatEnrollmentActiveRange, isEnrollmentActive, toCalendarDate, validZoneOrUtc } from "./school-enrollment";

// 2026-09-30 03:30 UTC is still Sep 29 in Chicago. This is the instant that made the roster
// render "Sep 30" on the UTC server and "Sep 29" in a Central browser (hydration failure).
const lateEvening = "2026-09-30T03:30:00.000Z";

describe("toCalendarDate", () => {
  it("reads an instant in the household timezone, not the runtime's", () => {
    expect(toCalendarDate(lateEvening, "America/Chicago")).toBe("2026-09-29");
    expect(toCalendarDate(lateEvening, "Europe/London")).toBe("2026-09-30");
  });

  it("passes a date-only value straight through", () => {
    expect(toCalendarDate("2026-09-30", "America/Chicago")).toBe("2026-09-30");
    expect(toCalendarDate("2026-09-30", "Pacific/Kiritimati")).toBe("2026-09-30");
  });
});

describe("validZoneOrUtc", () => {
  it("keeps a real zone", () => {
    expect(validZoneOrUtc("America/Chicago")).toBe("America/Chicago");
  });

  it("falls back to UTC, never the device zone, for missing or invalid zones", () => {
    expect(validZoneOrUtc(null)).toBe("UTC");
    expect(validZoneOrUtc(undefined)).toBe("UTC");
    expect(validZoneOrUtc("")).toBe("UTC");
    expect(validZoneOrUtc("Not/AZone")).toBe("UTC");
  });

  it("makes a timestamp read the same on the server and in the browser when the zone is unknown", () => {
    // The same answer no matter which machine renders it, because it never consults the device.
    expect(toCalendarDate(lateEvening, null)).toBe("2026-09-30");
    expect(toCalendarDate(lateEvening, "Not/AZone")).toBe("2026-09-30");
  });
});

describe("formatEnrollmentActiveRange", () => {
  it("formats createdAt in the household zone with a fixed locale", () => {
    expect(formatEnrollmentActiveRange(null, null, lateEvening, "America/Chicago")).toBe("Enrolled Sep 29, 2026");
    expect(formatEnrollmentActiveRange(null, null, lateEvening, "Europe/London")).toBe("Enrolled Sep 30, 2026");
  });

  it("is independent of the process timezone for date-only ranges", () => {
    const label = formatEnrollmentActiveRange("2026-09-01", "2027-06-30", null, "America/Chicago");
    expect(label).toBe("Sep 1, 2026 – Jun 30, 2027");
    expect(formatEnrollmentActiveRange("2026-09-01", null, null, null)).toBe("From Sep 1, 2026");
    expect(formatEnrollmentActiveRange(null, "2027-06-30", null, null)).toBe("Until Jun 30, 2027");
  });

  it("prefers the active dates over createdAt, and returns null with nothing", () => {
    expect(formatEnrollmentActiveRange("2026-09-01", null, lateEvening, "UTC")).toBe("From Sep 1, 2026");
    expect(formatEnrollmentActiveRange(null, null, null, "UTC")).toBeNull();
  });
});

describe("isEnrollmentActive", () => {
  it("includes both end dates and compares plain dates", () => {
    expect(isEnrollmentActive("2026-09-01", "2026-09-30", "2026-09-01")).toBe(true);
    expect(isEnrollmentActive("2026-09-01", "2026-09-30", "2026-09-30")).toBe(true);
    expect(isEnrollmentActive("2026-09-01", "2026-09-30", "2026-08-31")).toBe(false);
    expect(isEnrollmentActive("2026-09-01", "2026-09-30", "2026-10-01")).toBe(false);
  });

  it("treats missing bounds as open", () => {
    expect(isEnrollmentActive(null, null, "2026-09-30")).toBe(true);
    expect(isEnrollmentActive("2026-10-01", null, "2026-09-30")).toBe(false);
    expect(isEnrollmentActive(null, "2026-09-29", "2026-09-30")).toBe(false);
  });
});
