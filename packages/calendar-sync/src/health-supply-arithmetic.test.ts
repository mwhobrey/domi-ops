import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAD_DAYS,
  MAX_LEAD_DAYS,
  MAX_SUPPLY_DAYS,
  computeSupply,
  daysBetween,
  daysRemaining,
  effectiveLeadDays,
  estimateNeedsConfirmation,
  mergeRanges,
  organizerCoverage,
  refillDeadline,
  refillReminderAt,
  refillStatus,
  type DateRange,
} from "./health-supply-arithmetic.js";

const TODAY = "2026-10-05";
const r = (from: string, to: string): DateRange => ({ from, to });

describe("daysBetween", () => {
  it("counts whole days across month, leap and year ends, in either direction", () => {
    expect(daysBetween("2026-10-05", "2026-10-05")).toBe(0);
    expect(daysBetween("2026-10-05", "2026-11-15")).toBe(41);
    expect(daysBetween("2026-11-15", "2026-10-05")).toBe(-41);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("is not thrown by the days daylight saving changes", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("refuses a date that is not on the calendar", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "10/05/2026", "", "2026-1-5", "2026-10-05T10:00", "+002026-10-05", "tomorrow", "2026-10-5"]) {
      expect(() => daysBetween(bad, TODAY), bad).toThrow(/Not a calendar date/);
      expect(() => daysBetween(TODAY, bad), bad).toThrow(/Not a calendar date/);
    }
  });
});

describe("mergeRanges", () => {
  it("counts days covered twice once, whatever order the fills arrive in", () => {
    expect(mergeRanges([r("2026-10-20", "2026-10-30"), r("2026-10-05", "2026-10-25")])).toEqual([r("2026-10-05", "2026-10-30")]);
  });

  it("joins ranges that touch, because there is no gap between them", () => {
    expect(mergeRanges([r("2026-10-05", "2026-10-10"), r("2026-10-11", "2026-10-20")])).toEqual([r("2026-10-05", "2026-10-20")]);
    expect(mergeRanges([r("2026-10-31", "2026-10-31"), r("2026-11-01", "2026-11-02")])).toEqual([r("2026-10-31", "2026-11-02")]);
  });

  it("keeps ranges apart when a day is missing between them", () => {
    expect(mergeRanges([r("2026-10-05", "2026-10-10"), r("2026-10-12", "2026-10-20")])).toEqual([
      r("2026-10-05", "2026-10-10"),
      r("2026-10-12", "2026-10-20"),
    ]);
  });

  it("absorbs a range inside another and a duplicate", () => {
    expect(mergeRanges([r("2026-10-05", "2026-10-30"), r("2026-10-10", "2026-10-12"), r("2026-10-05", "2026-10-30")])).toEqual([r("2026-10-05", "2026-10-30")]);
  });

  it("handles one-day ranges, nothing at all, and does not change what it was given", () => {
    expect(mergeRanges([])).toEqual([]);
    expect(mergeRanges([r(TODAY, TODAY)])).toEqual([r(TODAY, TODAY)]);
    const input = [r("2026-10-20", "2026-10-30"), r("2026-10-05", "2026-10-25")];
    mergeRanges(input);
    expect(input).toEqual([r("2026-10-20", "2026-10-30"), r("2026-10-05", "2026-10-25")]);
  });

  it("refuses a range that ends before it starts, or a day that does not exist", () => {
    expect(() => mergeRanges([r("2026-10-10", "2026-10-09")])).toThrow(RangeError);
    expect(() => mergeRanges([r("2026-02-30", "2026-03-02")])).toThrow(RangeError);
  });
});

describe("organizerCoverage", () => {
  it("counts a fill that starts today, including today", () => {
    expect(organizerCoverage([r(TODAY, "2026-11-04")], TODAY)).toEqual({ days: 31, endsOn: "2026-11-04", hasGap: false });
  });

  it("counts only what is left of a fill that started earlier", () => {
    // Filled for 31 days from 2026-09-30; today is day 6, so 26 days remain counting today.
    expect(organizerCoverage([r("2026-09-30", "2026-10-30")], TODAY)).toEqual({ days: 26, endsOn: "2026-10-30", hasGap: false });
  });

  it("is one day when the fill ends today, and nothing when it ended yesterday", () => {
    expect(organizerCoverage([r("2026-09-05", TODAY)], TODAY)).toEqual({ days: 1, endsOn: TODAY, hasGap: false });
    expect(organizerCoverage([r("2026-09-05", "2026-10-04")], TODAY)).toEqual({ days: 0, endsOn: null, hasGap: false });
  });

  it("counts overlapping fills once, and touching fills as one stretch", () => {
    expect(organizerCoverage([r(TODAY, "2026-10-20"), r("2026-10-15", "2026-10-31")], TODAY).days).toBe(27);
    expect(organizerCoverage([r(TODAY, "2026-10-09"), r("2026-10-10", "2026-10-14")], TODAY)).toEqual({ days: 10, endsOn: "2026-10-14", hasGap: false });
  });

  it("stops at a gap and says so", () => {
    expect(organizerCoverage([r(TODAY, "2026-10-14"), r("2026-10-20", "2026-10-31")], TODAY)).toEqual({ days: 10, endsOn: "2026-10-14", hasGap: true });
  });

  it("calls a fill that has not started a gap, because today has nothing in it", () => {
    expect(organizerCoverage([r("2026-10-07", "2026-11-06")], TODAY)).toEqual({ days: 0, endsOn: null, hasGap: true });
  });

  it("ignores everything already in the past, but still sees a gap before newer coverage", () => {
    expect(organizerCoverage([r("2026-08-01", "2026-08-31")], TODAY)).toEqual({ days: 0, endsOn: null, hasGap: false });
    expect(organizerCoverage([r("2026-08-01", "2026-08-31"), r("2026-10-10", "2026-10-20")], TODAY)).toEqual({ days: 0, endsOn: null, hasGap: true });
  });

  it("has nothing to count with no fills", () => {
    expect(organizerCoverage([], TODAY)).toEqual({ days: 0, endsOn: null, hasGap: false });
  });

  it("crosses a month end and a leap day", () => {
    expect(organizerCoverage([r("2026-10-29", "2026-11-02")], "2026-10-30").days).toBe(4);
    expect(organizerCoverage([r("2028-02-27", "2028-03-02")], "2028-02-28").days).toBe(4);
  });
});

describe("computeSupply", () => {
  it("adds organizers to what is outside them: 31 + 10 is 41 days, running out on day 42", () => {
    const e = computeSupply({ today: TODAY, ranges: [r(TODAY, "2026-11-04")], outsideDays: 10 });
    expect(e).toEqual({ needsConfirmation: false, organizerDays: 31, outsideDays: 10, totalDays: 41, runsOutOn: "2026-11-15", confirmed: false });
    expect(daysBetween(TODAY, "2026-11-15")).toBe(41);
  });

  it("counts only the part of the organizers still ahead", () => {
    const e = computeSupply({ today: TODAY, ranges: [r("2026-09-30", "2026-10-30")], outsideDays: 10 });
    expect(e).toMatchObject({ organizerDays: 26, totalDays: 36, runsOutOn: "2026-11-10" });
  });

  it("handles outside pills with no organizers, and organizers with none outside", () => {
    expect(computeSupply({ today: TODAY, ranges: [], outsideDays: 30 })).toMatchObject({ organizerDays: 0, totalDays: 30, runsOutOn: "2026-11-04" });
    expect(computeSupply({ today: TODAY, ranges: [r(TODAY, "2026-10-14")], outsideDays: 0 })).toMatchObject({ totalDays: 10, runsOutOn: "2026-10-15" });
  });

  it("runs out today when there is no supply at all", () => {
    expect(computeSupply({ today: TODAY, ranges: [], outsideDays: 0 })).toMatchObject({ totalDays: 0, runsOutOn: TODAY, needsConfirmation: false });
    expect(daysRemaining(TODAY, TODAY)).toBe(0);
  });

  it("counts overlapping fills once", () => {
    const e = computeSupply({ today: TODAY, ranges: [r(TODAY, "2026-10-24"), r("2026-10-15", "2026-11-04")], outsideDays: 0 });
    expect(e).toMatchObject({ organizerDays: 31, totalDays: 31 });
  });

  it("will not guess when there is a gap: it asks for the total", () => {
    const e = computeSupply({ today: TODAY, ranges: [r(TODAY, "2026-10-14"), r("2026-10-20", "2026-10-31")], outsideDays: 10 });
    expect(e).toEqual({ needsConfirmation: true, organizerDays: 10, organizerEndsOn: "2026-10-14" });
  });

  it("will not guess when the organizers have not started either", () => {
    const e = computeSupply({ today: TODAY, ranges: [r("2026-10-07", "2026-11-06")], outsideDays: 5 });
    expect(e).toMatchObject({ needsConfirmation: true, organizerDays: 0, organizerEndsOn: null });
  });

  it("uses the confirmed total as given, keeping the unbroken organizer run and putting the rest outside", () => {
    const e = computeSupply({
      today: TODAY,
      ranges: [r(TODAY, "2026-10-14"), r("2026-10-20", "2026-10-31")],
      outsideDays: 10,
      confirmedTotalDays: 40,
    });
    expect(e).toEqual({ needsConfirmation: false, organizerDays: 10, outsideDays: 30, totalDays: 40, runsOutOn: "2026-11-14", confirmed: true });
  });

  it("never counts more organizer days than the confirmed total", () => {
    const gap = [r(TODAY, "2026-10-14"), r("2026-10-20", "2026-10-31")];
    expect(computeSupply({ today: TODAY, ranges: gap, outsideDays: 0, confirmedTotalDays: 4 })).toMatchObject({ organizerDays: 4, outsideDays: 0, totalDays: 4 });
    expect(computeSupply({ today: TODAY, ranges: gap, outsideDays: 0, confirmedTotalDays: 0 })).toMatchObject({ organizerDays: 0, totalDays: 0, runsOutOn: TODAY });
  });

  it("ignores a confirmed total when there is no gap to confirm", () => {
    const e = computeSupply({ today: TODAY, ranges: [r(TODAY, "2026-11-04")], outsideDays: 10, confirmedTotalDays: 999 });
    expect(e).toMatchObject({ totalDays: 41, confirmed: false });
  });

  it("gives a different answer tomorrow for the same fills, as the organizers empty", () => {
    const ranges = [r(TODAY, "2026-11-04")];
    expect(computeSupply({ today: TODAY, ranges, outsideDays: 10 })).toMatchObject({ totalDays: 41, runsOutOn: "2026-11-15" });
    expect(computeSupply({ today: "2026-10-06", ranges, outsideDays: 10 })).toMatchObject({ totalDays: 40, runsOutOn: "2026-11-15" });
  });

  it("replaces an estimate when a refill arrives: the new total is what counts", () => {
    const ranges = [r(TODAY, "2026-10-24")];
    const before = computeSupply({ today: TODAY, ranges, outsideDays: 5 });
    const after = computeSupply({ today: TODAY, ranges, outsideDays: 30 });
    expect(before).toMatchObject({ runsOutOn: "2026-10-30" });
    expect(after).toMatchObject({ runsOutOn: "2026-11-24" });
  });

  it("refuses numbers that are not whole days within bounds", () => {
    for (const outsideDays of [-1, 1.5, Number.NaN, MAX_SUPPLY_DAYS + 1]) {
      expect(() => computeSupply({ today: TODAY, ranges: [], outsideDays }), `outside ${outsideDays}`).toThrow(RangeError);
    }
    expect(() => computeSupply({ today: TODAY, ranges: [r(TODAY, "2026-10-09"), r("2026-10-20", "2026-10-25")], outsideDays: 0, confirmedTotalDays: -1 })).toThrow(RangeError);
    expect(() => computeSupply({ today: TODAY, ranges: [r(TODAY, "2026-10-09"), r("2026-10-20", "2026-10-25")], outsideDays: 0, confirmedTotalDays: 2.5 })).toThrow(RangeError);
    expect(computeSupply({ today: TODAY, ranges: [], outsideDays: MAX_SUPPLY_DAYS })).toMatchObject({ totalDays: 3650 });
  });

  it("refuses a total past the limit even when each part is fine", () => {
    expect(() => computeSupply({ today: TODAY, ranges: [r(TODAY, "2026-11-04")], outsideDays: MAX_SUPPLY_DAYS })).toThrow(RangeError);
  });
});

describe("daysRemaining", () => {
  it("shrinks one a day, is 0 on the run-out day and after, and never negative", () => {
    expect(daysRemaining("2026-11-15", "2026-10-05")).toBe(41);
    expect(daysRemaining("2026-11-15", "2026-10-06")).toBe(40);
    expect(daysRemaining("2026-11-15", "2026-11-14")).toBe(1);
    expect(daysRemaining("2026-11-15", "2026-11-15")).toBe(0);
    expect(daysRemaining("2026-11-15", "2026-11-16")).toBe(0);
    expect(daysRemaining("2026-11-15", "2027-03-01")).toBe(0);
  });
});

describe("effectiveLeadDays", () => {
  it("prefers the medication's choice, then the person's, then 7", () => {
    expect(effectiveLeadDays(14, 10)).toBe(14);
    expect(effectiveLeadDays(null, 10)).toBe(10);
    expect(effectiveLeadDays(undefined, 10)).toBe(10);
    expect(effectiveLeadDays(null, null)).toBe(DEFAULT_LEAD_DAYS);
    expect(effectiveLeadDays(undefined, undefined)).toBe(7);
  });

  it("treats 0 as a real choice, not as 'not set'", () => {
    expect(effectiveLeadDays(0, 10)).toBe(0);
    expect(effectiveLeadDays(null, 0)).toBe(0);
  });

  it("accepts up to 90 and refuses anything else", () => {
    expect(effectiveLeadDays(MAX_LEAD_DAYS, null)).toBe(90);
    for (const bad of [-1, 91, 1.5, Number.NaN]) expect(() => effectiveLeadDays(bad, null), `${bad}`).toThrow(RangeError);
    expect(() => effectiveLeadDays(null, 91)).toThrow(RangeError);
  });
});

describe("refillDeadline", () => {
  it("is the lead time before running out, across month and year ends", () => {
    expect(refillDeadline("2026-11-15", 7)).toBe("2026-11-08");
    expect(refillDeadline("2026-11-03", 7)).toBe("2026-10-27");
    expect(refillDeadline("2027-01-02", 7)).toBe("2026-12-26");
    expect(refillDeadline("2028-03-02", 3)).toBe("2028-02-28");
  });

  it("is the run-out day itself with no lead time", () => {
    expect(refillDeadline("2026-11-15", 0)).toBe("2026-11-15");
  });

  it("refuses a bad lead time or date", () => {
    expect(() => refillDeadline("2026-11-15", -1)).toThrow(RangeError);
    expect(() => refillDeadline("2026-11-15", 91)).toThrow(RangeError);
    expect(() => refillDeadline("2026-02-30", 7)).toThrow(RangeError);
  });
});

describe("refillReminderAt", () => {
  it("is nine in the morning in the household's own time", () => {
    expect(refillReminderAt("2026-10-31", "America/Chicago").toISOString()).toBe("2026-10-31T14:00:00.000Z"); // CDT, UTC-5
    expect(refillReminderAt("2026-11-02", "America/Chicago").toISOString()).toBe("2026-11-02T15:00:00.000Z"); // CST, UTC-6
    expect(refillReminderAt("2026-10-05", "UTC").toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(refillReminderAt("2026-10-05", "Asia/Kolkata").toISOString()).toBe("2026-10-05T03:30:00.000Z");
  });

  it("is still nine o'clock on the days the clocks change", () => {
    expect(refillReminderAt("2026-11-01", "America/Chicago").toISOString()).toBe("2026-11-01T15:00:00.000Z"); // fall back, now CST
    expect(refillReminderAt("2026-03-08", "America/Chicago").toISOString()).toBe("2026-03-08T14:00:00.000Z"); // spring forward, now CDT
    expect(refillReminderAt("2026-03-07", "America/Chicago").toISOString()).toBe("2026-03-07T15:00:00.000Z");
  });

  it("is the previous UTC day for a household far ahead of UTC", () => {
    expect(refillReminderAt("2026-10-05", "Pacific/Auckland").toISOString()).toBe("2026-10-04T20:00:00.000Z"); // NZDT, UTC+13
    expect(refillReminderAt("2026-10-05", "Pacific/Kiritimati").toISOString()).toBe("2026-10-04T19:00:00.000Z"); // UTC+14
  });
});

describe("refillStatus", () => {
  const base: Parameters<typeof refillStatus>[0] = {
    today: TODAY,
    runsOutOn: "2026-10-20",
    leadDays: 7,
    medicationEndDate: null,
    active: true,
    requested: false,
  };
  // Run-out 2026-10-20 with 7 days' notice: the deadline is 2026-10-13.
  const at = (today: string, over: Partial<typeof base> = {}) => refillStatus({ ...base, today, ...over });

  it("is fine until the deadline day", () => {
    expect(at("2026-10-05")).toEqual({ state: "ok", daysRemaining: 15, deadline: "2026-10-13", overdue: false });
    expect(at("2026-10-12")).toMatchObject({ state: "ok", daysRemaining: 8, overdue: false });
  });

  it("needs a refill from the deadline day, and is overdue only after it", () => {
    expect(at("2026-10-13")).toEqual({ state: "needs_refill", daysRemaining: 7, deadline: "2026-10-13", overdue: false });
    expect(at("2026-10-14")).toMatchObject({ state: "needs_refill", overdue: true });
    expect(at("2026-10-20")).toMatchObject({ state: "needs_refill", daysRemaining: 0, overdue: true });
    expect(at("2026-10-27")).toMatchObject({ state: "needs_refill", daysRemaining: 0, overdue: true });
  });

  it("stays requested until received, whether asked early, on time or late", () => {
    expect(at("2026-10-05", { requested: true })).toMatchObject({ state: "requested", overdue: false });
    expect(at("2026-10-13", { requested: true })).toMatchObject({ state: "requested", overdue: false });
    expect(at("2026-10-16", { requested: true })).toMatchObject({ state: "requested", overdue: true });
  });

  it("has nothing to say for a paused or deleted medication, even if it was requested", () => {
    expect(at("2026-10-16", { active: false })).toEqual({ state: "inactive", daysRemaining: null, deadline: null, overdue: false });
    expect(at("2026-10-16", { active: false, requested: true })).toMatchObject({ state: "inactive" });
  });

  it("says no estimate without one, but still shows a request that was made", () => {
    expect(at("2026-10-16", { runsOutOn: null })).toEqual({ state: "no_estimate", daysRemaining: null, deadline: null, overdue: false });
    expect(at("2026-10-16", { runsOutOn: null, requested: true })).toMatchObject({ state: "requested", daysRemaining: null, overdue: false });
  });

  it("needs no refill when the supply lasts to the medication's last day", () => {
    expect(at("2026-10-16", { medicationEndDate: "2026-10-19" })).toEqual({ state: "not_needed", daysRemaining: 4, deadline: null, overdue: false });
    expect(at("2026-10-16", { medicationEndDate: "2026-10-19", runsOutOn: "2026-10-20" })).toMatchObject({ state: "not_needed" });
  });

  it("still needs one when it runs out on or before the last day", () => {
    expect(at("2026-10-16", { medicationEndDate: "2026-10-20" })).toMatchObject({ state: "needs_refill" });
    expect(at("2026-10-16", { medicationEndDate: "2026-10-31" })).toMatchObject({ state: "needs_refill" });
  });

  it("uses the lead time it is given, including none", () => {
    expect(at("2026-10-19", { leadDays: 1 })).toMatchObject({ state: "needs_refill", deadline: "2026-10-19", overdue: false });
    expect(at("2026-10-19", { leadDays: 0 })).toMatchObject({ state: "ok", deadline: "2026-10-20" });
    expect(at("2026-10-20", { leadDays: 0 })).toMatchObject({ state: "needs_refill", overdue: false });
    expect(at("2026-10-05", { leadDays: 30 })).toMatchObject({ state: "needs_refill", overdue: true });
  });

  it("is due at once when an estimate is entered inside the lead window", () => {
    expect(at(TODAY, { runsOutOn: "2026-10-08" })).toMatchObject({ state: "needs_refill", deadline: "2026-10-01", overdue: true });
  });
});

describe("estimateNeedsConfirmation", () => {
  const made = new Date("2026-10-05T14:00:00Z");

  it("is true when the medication was paused and resumed after the estimate", () => {
    expect(estimateNeedsConfirmation(made, [{ pausedAt: new Date("2026-10-10T00:00:00Z"), resumedAt: new Date("2026-10-20T00:00:00Z") }])).toBe(true);
  });

  it("is false for a pause that ended before the estimate, one still going, and none at all", () => {
    expect(estimateNeedsConfirmation(made, [{ pausedAt: new Date("2026-09-01T00:00:00Z"), resumedAt: new Date("2026-09-10T00:00:00Z") }])).toBe(false);
    expect(estimateNeedsConfirmation(made, [{ pausedAt: new Date("2026-10-10T00:00:00Z"), resumedAt: null }])).toBe(false);
    expect(estimateNeedsConfirmation(made, [])).toBe(false);
  });

  it("is false when it resumed at the very moment of the estimate, and true a moment later", () => {
    expect(estimateNeedsConfirmation(made, [{ pausedAt: new Date("2026-10-01T00:00:00Z"), resumedAt: made }])).toBe(false);
    expect(estimateNeedsConfirmation(made, [{ pausedAt: new Date("2026-10-01T00:00:00Z"), resumedAt: new Date(made.getTime() + 1) }])).toBe(true);
  });

  it("looks at every pause, not just the first", () => {
    expect(
      estimateNeedsConfirmation(made, [
        { pausedAt: new Date("2026-09-01T00:00:00Z"), resumedAt: new Date("2026-09-02T00:00:00Z") },
        { pausedAt: new Date("2026-10-10T00:00:00Z"), resumedAt: new Date("2026-10-11T00:00:00Z") },
      ]),
    ).toBe(true);
  });
});
