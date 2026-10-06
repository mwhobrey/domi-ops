import { describe, expect, it } from "vitest";
import { diffPlacements, fillProgress, nextUncoveredDay } from "./health-organizer-session-logic.js";
import type { Placement } from "./health-organizer-placements.js";

const place = (medicationId: string, date: string, time: string, compartmentId: string, quarters: number): Placement => ({
  medicationId,
  date,
  time,
  compartmentId,
  quarters,
});

describe("fillProgress", () => {
  const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];

  it("is pending when nothing is covered, filled when everything is", () => {
    expect(fillProgress(days, [])).toMatchObject({ status: "pending", requiredCount: 5, coveredCount: 0, covered: [] });
    expect(fillProgress(days, [{ from: "2026-06-01", to: "2026-06-05" }])).toMatchObject({ status: "filled", coveredCount: 5, missing: [] });
  });

  it("is partial when some days are covered, and says which are missing, run together", () => {
    const p = fillProgress(days, [{ from: "2026-06-01", to: "2026-06-02" }]);
    expect(p).toMatchObject({ status: "partial", coveredCount: 2, missing: [{ from: "2026-06-03", to: "2026-06-05" }] });
    const gappy = fillProgress(days, [{ from: "2026-06-02", to: "2026-06-02" }, { from: "2026-06-04", to: "2026-06-04" }]);
    expect(gappy.missing).toEqual([
      { from: "2026-06-01", to: "2026-06-01" },
      { from: "2026-06-03", to: "2026-06-03" },
      { from: "2026-06-05", to: "2026-06-05" },
    ]);
  });

  it("merges overlapping and touching fills and counts each day once", () => {
    const p = fillProgress(days, [{ from: "2026-06-01", to: "2026-06-03" }, { from: "2026-06-03", to: "2026-06-04" }, { from: "2026-06-05", to: "2026-06-05" }]);
    expect(p).toMatchObject({ status: "filled", coveredCount: 5, covered: [{ from: "2026-06-01", to: "2026-06-05" }] });
  });

  it("only counts days that have a dose, even when a fill reaches beyond them", () => {
    const p = fillProgress(["2026-06-02", "2026-06-09"], [{ from: "2026-05-01", to: "2026-06-05" }]);
    expect(p).toMatchObject({ status: "partial", requiredCount: 2, coveredCount: 1, missing: [{ from: "2026-06-09", to: "2026-06-09" }] });
  });

  it("treats days with no dose between filled ones as not needing anything", () => {
    // a weekly medication: only two days in the window need pills, both covered by one fill
    expect(fillProgress(["2026-06-02", "2026-06-09"], [{ from: "2026-06-01", to: "2026-06-10" }]).status).toBe("filled");
  });

  it("has nothing to fill when the medication has no dose in the window, and ignores repeats and order", () => {
    expect(fillProgress([], [{ from: "2026-06-01", to: "2026-06-05" }])).toMatchObject({ status: "nothing_to_fill", requiredCount: 0 });
    expect(fillProgress(["2026-06-03", "2026-06-01", "2026-06-03"], []).requiredCount).toBe(2);
  });

  it("joins missing days across a month end", () => {
    const p = fillProgress(["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"], [{ from: "2026-06-29", to: "2026-06-29" }]);
    expect(p.missing).toEqual([{ from: "2026-06-30", to: "2026-07-02" }]);
  });
});

describe("nextUncoveredDay", () => {
  it("is today with nothing filled, or when everything filled has already run out", () => {
    expect(nextUncoveredDay([], "2026-06-10")).toBe("2026-06-10");
    expect(nextUncoveredDay([{ from: "2026-05-01", to: "2026-05-31" }], "2026-06-10")).toBe("2026-06-10");
    expect(nextUncoveredDay([{ from: "2026-05-01", to: "2026-06-09" }], "2026-06-10")).toBe("2026-06-10");
  });

  it("is the day after the last filled day when that is still ahead", () => {
    expect(nextUncoveredDay([{ from: "2026-06-01", to: "2026-06-30" }], "2026-06-10")).toBe("2026-07-01");
    expect(nextUncoveredDay([{ from: "2026-06-01", to: "2026-06-10" }], "2026-06-10")).toBe("2026-06-11");
  });

  it("goes by the furthest end among all, in any order", () => {
    expect(nextUncoveredDay([{ from: "2026-06-01", to: "2026-06-20" }, { from: "2026-06-01", to: "2026-07-05" }, { from: "2026-06-01", to: "2026-06-25" }], "2026-06-10")).toBe("2026-07-06");
  });

  it("rolls over a year end", () => {
    expect(nextUncoveredDay([{ from: "2026-12-01", to: "2026-12-31" }], "2026-12-20")).toBe("2027-01-01");
  });
});

describe("diffPlacements", () => {
  const a = [place("m1", "2026-06-01", "08:00", "c1", 4), place("m1", "2026-06-02", "08:00", "c1", 4), place("m2", "2026-06-01", "21:00", "c2", 2)];

  it("finds nothing when nothing changed, whatever the order", () => {
    expect(diffPlacements(a, [...a].reverse())).toEqual({ changed: false, medications: [] });
    expect(diffPlacements([], [])).toEqual({ changed: false, medications: [] });
  });

  it("reports a changed quantity and a changed compartment separately", () => {
    const b = [place("m1", "2026-06-01", "08:00", "c1", 6), place("m1", "2026-06-02", "08:00", "c9", 4), a[2]!];
    const d = diffPlacements(a, b);
    expect(d.changed).toBe(true);
    expect(d.medications).toEqual([
      { medicationId: "m1", kinds: ["quantity", "compartment"], added: 0, removed: 0, quantityChanged: 1, compartmentChanged: 1, dates: ["2026-06-01", "2026-06-02"] },
    ]);
  });

  it("reports doses that appear or disappear as a schedule change", () => {
    const b = [a[0]!, place("m1", "2026-06-03", "08:00", "c1", 4), a[2]!];
    const d = diffPlacements(a, b);
    expect(d.medications).toEqual([
      { medicationId: "m1", kinds: ["schedule"], added: 1, removed: 1, quantityChanged: 0, compartmentChanged: 0, dates: ["2026-06-02", "2026-06-03"] },
    ]);
  });

  it("sees a dose moved to another time of day as removed and added", () => {
    const d = diffPlacements([place("m1", "2026-06-01", "08:00", "c1", 4)], [place("m1", "2026-06-01", "09:00", "c1", 4)]);
    expect(d.medications[0]).toMatchObject({ kinds: ["schedule"], added: 1, removed: 1 });
  });

  it("covers a medication that is gone entirely and one that is new, ordered by id", () => {
    const d = diffPlacements([place("zz", "2026-06-01", "08:00", "c1", 4)], [place("aa", "2026-06-01", "08:00", "c1", 4)]);
    expect(d.medications.map((m) => [m.medicationId, m.kinds, m.added, m.removed])).toEqual([
      ["aa", ["schedule"], 1, 0],
      ["zz", ["schedule"], 0, 1],
    ]);
  });

  it("names at most eight of the days affected", () => {
    const before = Array.from({ length: 20 }, (_, i) => place("m1", `2026-06-${String(i + 1).padStart(2, "0")}`, "08:00", "c1", 4));
    const after = before.map((p) => ({ ...p, quarters: 8 }));
    const d = diffPlacements(before, after);
    expect(d.medications[0]!.quantityChanged).toBe(20);
    expect(d.medications[0]!.dates).toHaveLength(8);
    expect(d.medications[0]!.dates[0]).toBe("2026-06-01");
  });

  it("does not change its inputs", () => {
    const before = [...a];
    const after = [...a].reverse();
    diffPlacements(before, after);
    expect(before).toEqual(a);
    expect(after).toEqual([...a].reverse());
  });
});
