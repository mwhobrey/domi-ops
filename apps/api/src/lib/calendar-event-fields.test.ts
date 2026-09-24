import { describe, expect, it } from "vitest";
import {
  normalizeAttendeeIds,
  normalizeEventLocation,
  parseRepeatRuleBody,
  pickEventPatch,
  spanDays,
} from "./calendar-event-fields.js";

const MEMBER_A = "8f0c5d1e-3a55-4a4e-9b5c-111111111111";
const MEMBER_B = "8f0c5d1e-3a55-4a4e-9b5c-222222222222";

describe("normalizeEventLocation", () => {
  it("trims, clears blanks, and leaves unsent fields alone", () => {
    expect(normalizeEventLocation("  Dr. Lee, Suite 4 ")).toBe("Dr. Lee, Suite 4");
    expect(normalizeEventLocation("   ")).toBeNull();
    expect(normalizeEventLocation(null)).toBeNull();
    expect(normalizeEventLocation(undefined)).toBeUndefined();
  });
});

describe("normalizeAttendeeIds", () => {
  it("dedupes and clears an empty list", () => {
    expect(normalizeAttendeeIds([MEMBER_A, MEMBER_B, MEMBER_A])).toEqual([MEMBER_A, MEMBER_B]);
    expect(normalizeAttendeeIds([])).toBeNull();
    expect(normalizeAttendeeIds(undefined)).toBeUndefined();
  });

  it("rejects non-uuid entries and non-arrays", () => {
    expect(normalizeAttendeeIds(["mike"])).toBe("invalid");
    expect(normalizeAttendeeIds(MEMBER_A)).toBe("invalid");
  });
});

describe("parseRepeatRuleBody", () => {
  it("accepts yearly with an interval", () => {
    expect(parseRepeatRuleBody({ freq: "yearly", interval: 2 }, "2026-10-02")).toEqual({
      rule: { freq: "yearly", interval: 2, until: undefined, count: undefined, startDate: "2026-10-02" },
    });
  });

  it("rejects bad freq, interval, until, and until+count together", () => {
    expect(parseRepeatRuleBody({ freq: "hourly" }, "2026-10-02")).toEqual({ error: "invalid_repeat_freq" });
    expect(parseRepeatRuleBody({ freq: "daily", interval: 0 }, "2026-10-02")).toEqual({
      error: "invalid_repeat_interval",
    });
    expect(parseRepeatRuleBody({ freq: "daily", until: "2026-10-01" }, "2026-10-02")).toEqual({
      error: "invalid_repeat_until",
    });
    expect(
      parseRepeatRuleBody({ freq: "daily", until: "2026-12-01", count: 3 }, "2026-10-02"),
    ).toEqual({ error: "repeat_until_or_count" });
  });
});

describe("spanDays", () => {
  it("measures multi-day and overnight spans", () => {
    expect(spanDays("2026-10-02", "2026-10-04")).toBe(2);
    expect(spanDays("2026-10-31", "2026-11-01")).toBe(1);
    expect(spanDays("2026-10-02", null)).toBe(0);
    expect(spanDays("2026-10-02", "2026-10-01")).toBe(0);
  });
});

describe("pickEventPatch", () => {
  it("drops columns the client must not write", () => {
    expect(
      pickEventPatch({
        title: "PT",
        householdId: "other-household",
        googleEventId: "spoofed",
        recurringRuleId: null,
        syncStatus: "synced",
      }),
    ).toEqual({ title: "PT" });
  });
});
