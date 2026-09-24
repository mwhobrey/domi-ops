import { describe, expect, it } from "vitest";
import { attendeeNames, filterEventsByAttendee } from "./calendar-filters";
import { buildRepeatRule, repeatUnitLabel } from "./calendar-utils";

const form = {
  freq: "weekly" as const,
  interval: "2",
  ends: "never" as const,
  until: "",
  count: "",
  startDate: "2026-10-02",
};

describe("buildRepeatRule", () => {
  it("returns no rule for a one-off event", () => {
    expect(buildRepeatRule({ ...form, freq: "none" })).toEqual({ rule: null });
  });

  it("builds every-N rules with an optional end", () => {
    expect(buildRepeatRule(form)).toEqual({ rule: { freq: "weekly", interval: 2 } });
    expect(buildRepeatRule({ ...form, ends: "on", until: "2026-12-31" })).toEqual({
      rule: { freq: "weekly", interval: 2, until: "2026-12-31" },
    });
    expect(buildRepeatRule({ ...form, freq: "yearly", interval: "", ends: "after", count: "5" })).toEqual(
      { rule: { freq: "yearly", interval: 1, count: 5 } },
    );
  });

  it("rejects bad intervals, missing or early end dates, and bad counts", () => {
    expect(buildRepeatRule({ ...form, interval: "0" })).toHaveProperty("error");
    expect(buildRepeatRule({ ...form, ends: "on", until: "" })).toHaveProperty("error");
    expect(buildRepeatRule({ ...form, ends: "on", until: "2026-10-01" })).toHaveProperty("error");
    expect(buildRepeatRule({ ...form, ends: "after", count: "1.5" })).toHaveProperty("error");
  });
});

describe("repeatUnitLabel", () => {
  it("pluralizes by interval", () => {
    expect(repeatUnitLabel("weekly", 1)).toBe("week");
    expect(repeatUnitLabel("yearly", 3)).toBe("years");
  });
});

describe("attendee helpers", () => {
  const events = [
    { id: "a", attendeeMemberIds: ["m1", "m2"] },
    { id: "b", attendeeMemberIds: [] },
    { id: "c" },
  ];

  it("filters to one member's events, or passes everything through", () => {
    expect(filterEventsByAttendee(events, "m2").map((e) => e.id)).toEqual(["a"]);
    expect(filterEventsByAttendee(events, null)).toHaveLength(3);
  });

  it("names attendees and skips members who left", () => {
    const labels = new Map([["m1", "Mike"]]);
    expect(attendeeNames(["m1", "gone"], labels)).toEqual(["Mike"]);
    expect(attendeeNames(undefined, labels)).toEqual([]);
  });
});
