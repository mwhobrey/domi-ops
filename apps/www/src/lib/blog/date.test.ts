import { describe, expect, it } from "vitest";
import { chicagoMidnightUtcMs, formatPostDate, isPostPublished, parseDateOnly } from "./date";

const DATE = "2027-02-19";

describe("parseDateOnly", () => {
  it("parses a valid calendar date", () => {
    expect(parseDateOnly("2027-02-19")).toEqual({ year: 2027, month: 2, day: 19 });
  });

  it("rejects non-ISO and impossible dates", () => {
    expect(() => parseDateOnly("02/19/2027")).toThrow(/YYYY-MM-DD/);
    expect(() => parseDateOnly("2027-02-31")).toThrow(/Invalid blog date/);
  });
});

describe("isPostPublished (America/Chicago)", () => {
  it("is unpublished before Chicago midnight", () => {
    expect(isPostPublished(DATE, new Date("2027-02-18T23:59:59.000-06:00"))).toBe(false);
    expect(isPostPublished(DATE, new Date("2027-02-19T05:59:59.000Z"))).toBe(false);
  });

  it("is published at and after Chicago midnight", () => {
    expect(isPostPublished(DATE, new Date("2027-02-19T00:00:00.000-06:00"))).toBe(true);
    expect(isPostPublished(DATE, new Date("2027-02-19T06:00:00.000Z"))).toBe(true);
    expect(isPostPublished(DATE, new Date("2027-02-19T12:00:00.000-06:00"))).toBe(true);
    expect(isPostPublished(DATE, new Date("2027-02-20T00:00:00.000-06:00"))).toBe(true);
  });

  it("does not treat UTC midnight as Chicago midnight", () => {
    // 2027-02-19 00:00 UTC is still 6:00 PM on Feb 18 in Chicago (CST, UTC-6).
    expect(isPostPublished(DATE, new Date("2027-02-19T00:00:00.000Z"))).toBe(false);
  });

  it("uses the current time when now is omitted, and midnight is the exact boundary", () => {
    expect(chicagoMidnightUtcMs(DATE)).toBe(Date.parse("2027-02-19T06:00:00.000Z"));
    expect(isPostPublished(DATE, new Date(chicagoMidnightUtcMs(DATE) - 1))).toBe(false);
    expect(isPostPublished(DATE, new Date(chicagoMidnightUtcMs(DATE)))).toBe(true);
  });
});

describe("formatPostDate", () => {
  it("formats the calendar date without a timezone shift", () => {
    expect(formatPostDate("2027-02-19")).toBe("February 19, 2027");
  });
});
