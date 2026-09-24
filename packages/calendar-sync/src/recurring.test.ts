import { describe, expect, it } from "vitest";
import { occurrenceDates, parseRrule } from "./recurring.js";

describe("parseRrule", () => {
  it("parses weekly with until", () => {
    const p = parseRrule("FREQ=WEEKLY;BYDAY=MO;INTERVAL=1;UNTIL=20261231");
    expect(p?.freq).toBe("WEEKLY");
    expect(p?.until).toBe("2026-12-31");
  });

  it("parses monthly", () => {
    expect(parseRrule("FREQ=MONTHLY;INTERVAL=2")?.freq).toBe("MONTHLY");
  });

  it("parses yearly with count", () => {
    const p = parseRrule("FREQ=YEARLY;INTERVAL=1;COUNT=3");
    expect(p).toMatchObject({ freq: "YEARLY", interval: 1, count: 3 });
  });
});

function dates(rrule: string, start: string, from: string, to: string, seriesEnd?: string) {
  return occurrenceDates(parseRrule(rrule)!, start, from, to, seriesEnd);
}

describe("occurrenceDates", () => {
  it("keeps an every-2-weeks phase when resuming mid-series", () => {
    // Series starts Mon Sep 7; resuming on Sep 15 must skip Sep 14 (an off week).
    expect(dates("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "2026-09-07", "2026-09-15", "2026-10-20")).toEqual(
      ["2026-09-21", "2026-10-05", "2026-10-19"],
    );
  });

  it("keeps an every-3-days phase when resuming mid-series", () => {
    expect(dates("FREQ=DAILY;INTERVAL=3", "2026-09-01", "2026-09-05", "2026-09-12")).toEqual([
      "2026-09-07",
      "2026-09-10",
    ]);
  });

  it("counts COUNT from the series start, not from the resume point", () => {
    const rule = "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=3";
    expect(dates(rule, "2026-09-01", "2026-09-01", "2026-12-31")).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
    ]);
    expect(dates(rule, "2026-09-01", "2026-09-10", "2026-12-31")).toEqual(["2026-09-15"]);
  });

  it("stops at UNTIL and at the series end date", () => {
    expect(dates("FREQ=DAILY;INTERVAL=1;UNTIL=20260903", "2026-09-01", "2026-09-01", "2026-09-30")).toEqual(
      ["2026-09-01", "2026-09-02", "2026-09-03"],
    );
    expect(dates("FREQ=DAILY;INTERVAL=1", "2026-09-01", "2026-09-01", "2026-09-30", "2026-09-02")).toEqual(
      ["2026-09-01", "2026-09-02"],
    );
  });

  it("skips months without the start day instead of drifting", () => {
    expect(dates("FREQ=MONTHLY;INTERVAL=1", "2026-01-31", "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
  });

  it("repeats yearly, skipping Feb 29 in common years", () => {
    expect(dates("FREQ=YEARLY;INTERVAL=1", "2026-10-02", "2026-01-01", "2029-12-31")).toEqual([
      "2026-10-02",
      "2027-10-02",
      "2028-10-02",
      "2029-10-02",
    ]);
    expect(dates("FREQ=YEARLY;INTERVAL=1", "2028-02-29", "2028-01-01", "2032-12-31")).toEqual([
      "2028-02-29",
      "2032-02-29",
    ]);
  });

  it("returns nothing when the window ends before the series starts", () => {
    expect(dates("FREQ=DAILY;INTERVAL=1", "2026-09-10", "2026-09-01", "2026-09-05")).toEqual([]);
  });
});
