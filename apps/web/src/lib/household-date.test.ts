import { describe, expect, it } from "vitest";
import { todayIsoInTimeZone } from "./household-date";

// 2026-09-24 03:30 UTC: still Sep 23 in Chicago, already Sep 24 in London.
const instant = new Date("2026-09-24T03:30:00Z");

describe("todayIsoInTimeZone", () => {
  it("returns the household's calendar date, not the device's", () => {
    expect(todayIsoInTimeZone("America/Chicago", instant)).toBe("2026-09-23");
    expect(todayIsoInTimeZone("Europe/London", instant)).toBe("2026-09-24");
  });

  it("falls back to the device date for a missing or invalid zone", () => {
    const device = instant.toLocaleDateString("en-CA");
    expect(todayIsoInTimeZone(null, instant)).toBe(device);
    expect(todayIsoInTimeZone("Not/AZone", instant)).toBe(device);
  });
});
