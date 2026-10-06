import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/client-api";
import {
  addDays,
  compartmentLines,
  count,
  daysBetween,
  daysLeftAfter,
  defaultFillRange,
  fillEnd,
  fillErrorMessage,
  filterMedications,
  finishSummary,
  isStaleAnswer,
  missingAfter,
  progressLabel,
  rangeLabel,
  runsOfDates,
  sessionFromConflict,
} from "./filling-helpers";
import type { SessionMedication } from "./filling-types";

const med = (over: Partial<SessionMedication> = {}): SessionMedication => ({
  medicationId: "m1",
  name: "Metformin",
  dosage: "500 mg",
  instructions: null,
  status: "pending",
  requiredDays: 31,
  filledDays: 0,
  covered: [],
  missing: [{ from: "2026-10-06", to: "2026-11-05" }],
  totalPills: 62,
  byCompartment: [],
  placements: [],
  lastFill: null,
  ...over,
});

const apiError = (body: unknown, status = 409) => new ApiError("x", status, JSON.stringify(body));

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("counts days between, both ways", () => {
    expect(daysBetween("2026-10-06", "2026-11-05")).toBe(30);
    expect(daysBetween("2026-11-05", "2026-10-06")).toBe(-30);
  });
  it("labels a day and a stretch", () => {
    expect(rangeLabel({ from: "2026-10-06", to: "2026-10-06" })).toBe("Oct 6");
    expect(rangeLabel({ from: "2026-10-06", to: "2026-10-20" })).toBe("Oct 6 – Oct 20");
  });
  it("counts with the right plural", () => {
    expect(count(1, "day")).toBe("1 day");
    expect(count(0, "day")).toBe("0 days");
  });
});

describe("filterMedications", () => {
  const list = [med({ medicationId: "a", name: "Metformin", dosage: "500 mg" }), med({ medicationId: "b", name: "Lisinopril", dosage: "10 mg" })];
  it("shows everything for a blank search", () => {
    expect(filterMedications(list, "  ")).toHaveLength(2);
  });
  it("matches the name in any case, and the dosage", () => {
    expect(filterMedications(list, "LISIN").map((m) => m.medicationId)).toEqual(["b"]);
    expect(filterMedications(list, "500").map((m) => m.medicationId)).toEqual(["a"]);
  });
  it("finds nothing for something else", () => {
    expect(filterMedications(list, "zzz")).toEqual([]);
  });
  it("handles a medication without a dosage", () => {
    expect(filterMedications([med({ dosage: null })], "mg")).toEqual([]);
  });
});

describe("fill ranges", () => {
  it("starts at the first unfilled stretch", () => {
    expect(defaultFillRange(med({ missing: [{ from: "2026-10-20", to: "2026-10-25" }, { from: "2026-11-01", to: "2026-11-02" }] }))).toEqual({
      from: "2026-10-20",
      to: "2026-10-25",
    });
  });
  it("offers nothing when nothing is left", () => {
    expect(defaultFillRange(med({ missing: [] }))).toBeNull();
  });
  it("ends a fill after the days given, never past the session", () => {
    expect(fillEnd("2026-10-06", 10, "2026-11-05")).toBe("2026-10-15");
    expect(fillEnd("2026-10-06", 99, "2026-11-05")).toBe("2026-11-05");
    expect(fillEnd("2026-10-06", 0, "2026-11-05")).toBe("2026-10-06");
  });
  it("says how many days a fill leaves", () => {
    const missing = [{ from: "2026-10-06", to: "2026-11-05" }];
    expect(daysLeftAfter({ from: "2026-10-06", to: "2026-11-05" }, missing)).toBe(0);
    expect(daysLeftAfter({ from: "2026-10-06", to: "2026-10-20" }, missing)).toBe(16);
    expect(daysLeftAfter({ from: "2026-12-01", to: "2026-12-05" }, missing)).toBe(31);
  });
  it("counts across several unfilled stretches", () => {
    const missing = [{ from: "2026-10-06", to: "2026-10-08" }, { from: "2026-10-20", to: "2026-10-22" }];
    expect(daysLeftAfter({ from: "2026-10-07", to: "2026-10-21" }, missing)).toBe(2);
  });
  it("lists the days a fill leaves, splitting a stretch it falls inside", () => {
    expect(missingAfter({ from: "2026-10-10", to: "2026-10-12" }, [{ from: "2026-10-06", to: "2026-10-20" }])).toEqual([
      { from: "2026-10-06", to: "2026-10-09" },
      { from: "2026-10-13", to: "2026-10-20" },
    ]);
    expect(missingAfter({ from: "2026-10-06", to: "2026-10-20" }, [{ from: "2026-10-06", to: "2026-10-20" }])).toEqual([]);
    expect(missingAfter({ from: "2026-10-06", to: "2026-10-10" }, [{ from: "2026-10-06", to: "2026-10-20" }])).toEqual([{ from: "2026-10-11", to: "2026-10-20" }]);
  });
});

describe("compartmentLines", () => {
  const compartments = [
    { id: "n", name: "Night", position: 3 },
    { id: "m", name: "Morning", position: 0 },
    { id: "l", name: "Lunch", position: 1 },
  ];
  it("groups doses by compartment in organizer order, with days run together", () => {
    const placements = [
      { date: "2026-10-06", time: "08:00:00", compartmentId: "m", pills: 1.5 },
      { date: "2026-10-07", time: "08:00:00", compartmentId: "m", pills: 1.5 },
      { date: "2026-10-09", time: "08:00:00", compartmentId: "m", pills: 1.5 },
      { date: "2026-10-06", time: "21:00", compartmentId: "n", pills: 1 },
    ];
    const lines = compartmentLines(placements, compartments);
    expect(lines.map((l) => l.compartment.name)).toEqual(["Morning", "Night"]);
    expect(lines[0]!.pills).toBe(4.5);
    expect(lines[0]!.lines).toEqual([
      { time: "08:00", pills: 1.5, ranges: [{ from: "2026-10-06", to: "2026-10-07" }, { from: "2026-10-09", to: "2026-10-09" }], days: 3 },
    ]);
  });
  it("shows a medication that goes in several compartments in each, once per dose time", () => {
    const placements = [
      { date: "2026-10-06", time: "08:00", compartmentId: "m", pills: 1 },
      { date: "2026-10-06", time: "12:00", compartmentId: "l", pills: 0.5 },
      { date: "2026-10-06", time: "13:00", compartmentId: "l", pills: 0.5 },
    ];
    const lines = compartmentLines(placements, compartments);
    expect(lines.map((l) => [l.compartment.name, l.lines.length, l.pills])).toEqual([
      ["Morning", 1, 1],
      ["Lunch", 2, 1],
    ]);
  });
  it("separates the same time at different amounts", () => {
    const placements = [
      { date: "2026-10-06", time: "08:00", compartmentId: "m", pills: 1 },
      { date: "2026-10-07", time: "08:00", compartmentId: "m", pills: 2 },
    ];
    expect(compartmentLines(placements, compartments)[0]!.lines.map((l) => l.pills)).toEqual([1, 2]);
  });
  it("is empty without placements", () => {
    expect(compartmentLines([], compartments)).toEqual([]);
  });
});

describe("runsOfDates", () => {
  it("runs consecutive days together, ignoring order and repeats", () => {
    expect(runsOfDates(["2026-10-08", "2026-10-06", "2026-10-07", "2026-10-07", "2026-10-12"])).toEqual([
      { from: "2026-10-06", to: "2026-10-08" },
      { from: "2026-10-12", to: "2026-10-12" },
    ]);
  });
});

describe("progress and summary", () => {
  it("says how far along the session is", () => {
    expect(progressLabel({ total: 11, filled: 3, partial: 0, pending: 8 })).toBe("3 of 11 medications filled");
    expect(progressLabel({ total: 1, filled: 1, partial: 0, pending: 0 })).toBe("1 of 1 medication filled");
    expect(progressLabel({ total: 11, filled: 3, partial: 2, pending: 6 })).toBe("3 of 11 medications filled, 2 partly");
  });
  it("sorts medications into what is done and what is left", () => {
    const summary = finishSummary({
      medications: [
        med({ medicationId: "a", status: "filled" }),
        med({ medicationId: "b", status: "partial", missing: [{ from: "2026-10-20", to: "2026-11-05" }] }),
        med({ medicationId: "c", status: "pending" }),
        med({ medicationId: "d", status: "nothing_to_fill" }),
      ],
    });
    expect(summary.filled.map((m) => m.medicationId)).toEqual(["a"]);
    expect(summary.partial.map((p) => [p.medication.medicationId, p.missing])).toEqual([["b", [{ from: "2026-10-20", to: "2026-11-05" }]]]);
    expect(summary.pending.map((m) => m.medicationId)).toEqual(["c"]);
    expect(summary.nothingToFill.map((m) => m.medicationId)).toEqual(["d"]);
  });
});

describe("answers from the API", () => {
  const session = { id: "s1", medications: [], version: 4 };
  it("takes the session a conflict carries", () => {
    expect(sessionFromConflict(apiError({ error: "version_conflict", session }))?.version).toBe(4);
  });
  it("ignores answers without one, malformed ones and other errors", () => {
    expect(sessionFromConflict(apiError({ error: "version_conflict" }))).toBeNull();
    expect(sessionFromConflict(apiError({ session: { id: 1, medications: [] } }))).toBeNull();
    expect(sessionFromConflict(new ApiError("x", 500, "not json"))).toBeNull();
    expect(sessionFromConflict(new Error("boom"))).toBeNull();
  });
  it("treats conflict answers as stale views, not as failures to retry", () => {
    for (const code of ["version_conflict", "review_required", "session_not_open", "not_last_fill"]) {
      expect(isStaleAnswer(apiError({ error: code, session }))).toBe(true);
    }
    expect(isStaleAnswer(apiError({ error: "confirmation_required" }))).toBe(false);
    expect(isStaleAnswer(new Error("boom"))).toBe(false);
  });
  it("gives a sentence, never a code", () => {
    expect(fillErrorMessage(apiError({ error: "confirmation_required" }), "fallback")).toMatch(/gap/);
    expect(fillErrorMessage(apiError({ error: "something_new" }), "fallback")).toBe("fallback");
    expect(fillErrorMessage(new Error("x"), "fallback")).toBe("fallback");
  });
});
