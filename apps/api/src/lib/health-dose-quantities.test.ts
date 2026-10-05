import { describe, expect, it } from "vitest";
import {
  assertQuantitiesFitSchedule,
  doseQuantityView,
  parseDoseQuantities,
  scheduledTimes,
} from "./health-dose-quantities.js";
import { SupplyValidationError } from "./health-supply-validation.js";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof SupplyValidationError) return e.code;
    throw e;
  }
};

const sched = (times: string[]) => JSON.stringify({ times });

describe("parseDoseQuantities", () => {
  it("reads pills per time as whole quarters, keyed by HH:MM", () => {
    expect(parseDoseQuantities({ "08:00": 1.5, "21:00": 0.25, "12:00": 2 })).toEqual(
      new Map([
        ["08:00", 6],
        ["21:00", 1],
        ["12:00", 8],
      ]),
    );
    expect(parseDoseQuantities({})).toEqual(new Map());
  });

  it("treats 08:00 and 08:00:00 as the same time, and refuses both together", () => {
    expect(parseDoseQuantities({ "08:00:00": 1 })).toEqual(new Map([["08:00", 4]]));
    expect(codeOf(() => parseDoseQuantities({ "08:00": 1, "08:00:00": 2 }))).toBe("duplicate_dose_time");
  });

  it("refuses anything that is not a plain object", () => {
    for (const bad of [null, undefined, 5, "08:00", true, [], [1, 2], [["08:00", 1]]]) {
      expect(codeOf(() => parseDoseQuantities(bad)), JSON.stringify(bad)).toBe("invalid_dose_quantities");
    }
  });

  it("refuses more than a day's worth of times, and accepts exactly that many", () => {
    const entries = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`, 1]));
    expect(parseDoseQuantities(entries(48)).size).toBe(48);
    expect(codeOf(() => parseDoseQuantities(entries(49)))).toBe("too_many_dose_quantities");
  });

  it("passes on the first bad key or value, with the code for that problem", () => {
    expect(codeOf(() => parseDoseQuantities({ noon: 1 }))).toBe("invalid_dose_time");
    expect(codeOf(() => parseDoseQuantities({ "08:00": 0.3 }))).toBe("quantity_not_quarter_step");
    expect(codeOf(() => parseDoseQuantities({ "08:00": "1" }))).toBe("invalid_quantity");
    expect(codeOf(() => parseDoseQuantities({ "08:00": 0 }))).toBe("quantity_out_of_range");
  });
});

describe("scheduledTimes", () => {
  it("lists a scheduled medication's times as HH:MM, sorted and without repeats", () => {
    expect(scheduledTimes("scheduled", sched(["21:00", "08:00:00", "08:00", "12:30"]))).toEqual(["08:00", "12:30", "21:00"]);
  });

  it("has none for any other kind, whatever the stored schedule says", () => {
    for (const kind of ["prn", "otc", "interval"]) {
      expect(scheduledTimes(kind, sched(["08:00"])), kind).toEqual([]);
    }
  });

  it("copes with a missing or malformed schedule", () => {
    expect(scheduledTimes("scheduled", null)).toEqual([]);
    expect(scheduledTimes("scheduled", undefined)).toEqual([]);
    expect(scheduledTimes("scheduled", "{not json")).toEqual([]);
    expect(scheduledTimes("scheduled", "{}")).toEqual([]);
  });
});

describe("assertQuantitiesFitSchedule", () => {
  const q = (...times: string[]) => new Map(times.map((t) => [t, 4]));

  it("accepts quantities for times the medication takes, and an empty set for anything", () => {
    expect(codeOf(() => assertQuantitiesFitSchedule(q("08:00", "21:00"), "scheduled", sched(["08:00", "21:00", "12:00"])))).toBeNull();
    expect(codeOf(() => assertQuantitiesFitSchedule(new Map(), "prn", "{}"))).toBeNull();
    expect(codeOf(() => assertQuantitiesFitSchedule(new Map(), "scheduled", sched([])))).toBeNull();
  });

  it("refuses a time the medication does not take", () => {
    expect(codeOf(() => assertQuantitiesFitSchedule(q("08:00", "09:00"), "scheduled", sched(["08:00"])))).toBe("quantity_time_not_scheduled");
  });

  it("refuses quantities on a medication that is not scheduled, even if its stored schedule has times", () => {
    for (const kind of ["prn", "otc", "interval"]) {
      expect(codeOf(() => assertQuantitiesFitSchedule(q("08:00"), kind, sched(["08:00"]))), kind).toBe("quantities_need_scheduled_medication");
    }
  });
});

describe("doseQuantityView", () => {
  it("answers in pills, in time order, with nothing missing when every time has one", () => {
    const view = doseQuantityView(
      new Map([
        ["21:00", 4],
        ["08:00", 6],
      ]),
      "scheduled",
      sched(["08:00", "21:00"]),
    );
    expect(view.doseQuantities).toEqual({ "08:00": 1.5, "21:00": 1 });
    expect(Object.keys(view.doseQuantities)).toEqual(["08:00", "21:00"]);
    expect(view.doseQuantityIssues).toEqual({ missing: [], orphaned: [] });
  });

  it("lists the scheduled times with no quantity, in order", () => {
    expect(doseQuantityView(new Map([["12:00", 4]]), "scheduled", sched(["21:00", "08:00", "12:00"])).doseQuantityIssues).toEqual({
      missing: ["08:00", "21:00"],
      orphaned: [],
    });
    expect(doseQuantityView(undefined, "scheduled", sched(["08:00"])).doseQuantityIssues).toEqual({ missing: ["08:00"], orphaned: [] });
  });

  it("lists quantities for times that are no longer taken, in order", () => {
    const view = doseQuantityView(
      new Map([
        ["21:00", 4],
        ["08:00", 4],
        ["12:00", 4],
      ]),
      "scheduled",
      sched(["12:00"]),
    );
    expect(view.doseQuantityIssues).toEqual({ missing: [], orphaned: ["08:00", "21:00"] });
  });

  it("calls every quantity left behind when the medication stopped being scheduled", () => {
    const view = doseQuantityView(new Map([["08:00", 4]]), "prn", "{}");
    expect(view.doseQuantityIssues).toEqual({ missing: [], orphaned: ["08:00"] });
    expect(doseQuantityView(undefined, "interval", "{}").doseQuantityIssues).toEqual({ missing: [], orphaned: [] });
  });

  it("is empty for a medication with nothing set and nothing scheduled", () => {
    expect(doseQuantityView(undefined, "prn", "{}")).toEqual({ doseQuantities: {}, doseQuantityIssues: { missing: [], orphaned: [] } });
  });
});
