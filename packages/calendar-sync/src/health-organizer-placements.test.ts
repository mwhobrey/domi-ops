import { describe, expect, it } from "vitest";
import {
  MAX_ORGANIZER_DAYS,
  addDaysUtc,
  computePlacements,
  formatQuarters,
  type OrganizerCompartment,
  type OrganizerGroup,
  type OrganizerMedication,
  type PlacementInput,
} from "./health-organizer-placements.js";

// 2026-10-05 is a Monday. Doses are local dates plus HH:MM, so none of this depends on a time zone.
const MON = "2026-10-05";

const MORNING = { id: "c-morning", name: "Morning", position: 0 };
const LUNCH = { id: "c-lunch", name: "Lunch", position: 1 };
const SUPPER = { id: "c-supper", name: "Supper", position: 2 };
const NIGHT = { id: "c-night", name: "Night", position: 3 };
const COMPARTMENTS: OrganizerCompartment[] = [MORNING, LUNCH, SUPPER, NIGHT];
const TIME_MAP = new Map([
  ["08:00", MORNING.id],
  ["12:00", LUNCH.id],
  ["17:00", SUPPER.id],
  ["21:00", NIGHT.id],
]);

const med = (id: string, times: string[], over: Partial<OrganizerMedication> = {}): OrganizerMedication => ({
  id,
  scheduleKind: "scheduled",
  scheduleJson: JSON.stringify({ times }),
  startDate: null,
  endDate: null,
  enabled: true,
  ...over,
});

const group = (id: string, times: string[], medicationIds: string[], over: Partial<OrganizerGroup> = {}): OrganizerGroup => ({
  id,
  scheduleKind: "scheduled",
  scheduleJson: JSON.stringify({ times }),
  startDate: null,
  endDate: null,
  enabled: true,
  medicationIds,
  ...over,
});

/** { medId: { "08:00": quarters } } to the nested maps the generator takes. */
const qty = (q: Record<string, Record<string, number>>) =>
  new Map(Object.entries(q).map(([id, times]) => [id, new Map(Object.entries(times))]));

function run(over: Partial<PlacementInput> & Pick<PlacementInput, "medications">): ReturnType<typeof computePlacements> {
  return computePlacements({
    from: MON,
    days: 7,
    groups: [],
    compartments: COMPARTMENTS,
    timeMap: TIME_MAP,
    quantities: new Map(),
    ...over,
  });
}

const summary = (r: ReturnType<typeof computePlacements>, id: string) => r.byMedication.find((m) => m.medicationId === id)!;

describe("computePlacements", () => {
  describe("where each pill goes", () => {
    it("places every dose in its compartment with its quantity, in the order a person fills", () => {
      const r = run({
        days: 2,
        medications: [med("m1", ["21:00", "08:00"])],
        quantities: qty({ m1: { "08:00": 4, "21:00": 8 } }),
      });
      expect(r.from).toBe(MON);
      expect(r.to).toBe("2026-10-06");
      // Date by date, and within a day by compartment order (Morning before Night).
      expect(r.placements).toEqual([
        { medicationId: "m1", date: "2026-10-05", time: "08:00", compartmentId: MORNING.id, quarters: 4 },
        { medicationId: "m1", date: "2026-10-05", time: "21:00", compartmentId: NIGHT.id, quarters: 8 },
        { medicationId: "m1", date: "2026-10-06", time: "08:00", compartmentId: MORNING.id, quarters: 4 },
        { medicationId: "m1", date: "2026-10-06", time: "21:00", compartmentId: NIGHT.id, quarters: 8 },
      ]);
      expect(r.problems).toEqual([]);
      expect(r.notGuided).toEqual([]);
    });

    it("orders a day's placements by the compartments' order, not by the clock", () => {
      // Night is the first compartment in this organizer, so it comes before Morning.
      const r = run({
        days: 1,
        medications: [med("m1", ["08:00", "21:00"])],
        compartments: [{ ...NIGHT, position: 0 }, { ...MORNING, position: 1 }, LUNCH, SUPPER].map((c, i) => ({ ...c, position: i })),
        quantities: qty({ m1: { "08:00": 4, "21:00": 4 } }),
      });
      expect(r.placements.map((p) => p.time)).toEqual(["21:00", "08:00"]);
      expect(summary(r, "m1").byCompartment.map((c) => c.compartmentId)).toEqual([NIGHT.id, MORNING.id]);
    });

    it("totals a medication that goes in several compartments, per compartment and overall", () => {
      const r = run({
        days: 3,
        medications: [med("m1", ["12:00", "08:00", "21:00"])],
        quantities: qty({ m1: { "08:00": 4, "12:00": 2, "21:00": 6 } }),
      });
      expect(summary(r, "m1")).toEqual({
        medicationId: "m1",
        doseCount: 9,
        placedCount: 9,
        totalQuarters: 36,
        byCompartment: [
          { compartmentId: MORNING.id, quarters: 12 },
          { compartmentId: LUNCH.id, quarters: 6 },
          { compartmentId: NIGHT.id, quarters: 18 },
        ],
        dates: ["2026-10-05", "2026-10-06", "2026-10-07"],
        complete: true,
      });
    });

    it("keeps fractions exact: quarters add up with no floating point drift", () => {
      const r = run({
        days: 31,
        medications: [med("m1", ["08:00", "12:00", "17:00"])],
        quantities: qty({ m1: { "08:00": 1, "12:00": 2, "17:00": 3 } }),
      });
      // A quarter, a half and three quarters a day for 31 days: 6 quarters x 31.
      expect(summary(r, "m1").totalQuarters).toBe(186);
      expect(Number.isInteger(summary(r, "m1").totalQuarters)).toBe(true);
    });

    it("spreads several medications and sorts ties by time, then by medication", () => {
      const r = run({
        days: 1,
        medications: [med("b", ["08:00"]), med("a", ["08:00"])],
        quantities: qty({ a: { "08:00": 4 }, b: { "08:00": 4 } }),
      });
      expect(r.placements.map((p) => p.medicationId)).toEqual(["a", "b"]);
    });
  });

  describe("which days a dose exists", () => {
    it("honours the medication's weekdays", () => {
      // Mondays and Thursdays only, over two full weeks.
      const r = run({
        days: 14,
        medications: [med("m1", ["08:00"], { scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1, 4] }) })],
        quantities: qty({ m1: { "08:00": 4 } }),
      });
      expect(summary(r, "m1").dates).toEqual(["2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]);
    });

    it("treats the start and end dates as inclusive, and a medication that ended as having no doses", () => {
      const r = run({
        days: 7,
        medications: [
          med("window", ["08:00"], { startDate: "2026-10-07", endDate: "2026-10-09" }),
          med("ended", ["08:00"], { endDate: "2026-10-04" }),
          med("notYet", ["08:00"], { startDate: "2026-10-12" }),
        ],
        quantities: qty({ window: { "08:00": 4 }, ended: { "08:00": 4 }, notYet: { "08:00": 4 } }),
      });
      expect(summary(r, "window").dates).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
      // Nothing to fill is not a problem to fix.
      expect(summary(r, "ended")).toMatchObject({ doseCount: 0, placedCount: 0, complete: true, dates: [] });
      expect(summary(r, "notYet")).toMatchObject({ doseCount: 0, complete: true });
      expect(r.problems).toEqual([]);
    });

    it("works across a month end, a leap day and a year end", () => {
      const m = med("m1", ["08:00"]);
      const q = qty({ m1: { "08:00": 4 } });
      expect(run({ from: "2026-10-30", days: 4, medications: [m], quantities: q }).placements.map((p) => p.date)).toEqual([
        "2026-10-30",
        "2026-10-31",
        "2026-11-01",
        "2026-11-02",
      ]);
      expect(run({ from: "2028-02-28", days: 3, medications: [m], quantities: q }).placements.map((p) => p.date)).toEqual([
        "2028-02-28",
        "2028-02-29",
        "2028-03-01",
      ]);
      // 2026 is not a leap year.
      expect(run({ from: "2026-02-27", days: 3, medications: [m], quantities: q }).placements.map((p) => p.date)).toEqual([
        "2026-02-27",
        "2026-02-28",
        "2026-03-01",
      ]);
      expect(run({ from: "2026-12-30", days: 3, medications: [m], quantities: q }).placements.map((p) => p.date)).toEqual([
        "2026-12-30",
        "2026-12-31",
        "2027-01-01",
      ]);
    });

    it("covers a 31-day month and the daylight saving weekends without skipping or repeating a day", () => {
      // US clocks change 2026-03-08 and 2026-11-01; with dates and HH:MM there is nothing to shift.
      for (const from of ["2026-03-01", "2026-10-25"]) {
        const r = run({ from, days: 31, medications: [med("m1", ["08:00"])], quantities: qty({ m1: { "08:00": 4 } }) });
        const dates = r.placements.map((p) => p.date);
        expect(dates).toHaveLength(31);
        expect(new Set(dates).size).toBe(31);
        for (let i = 1; i < dates.length; i++) expect(dates[i]).toBe(addDaysUtc(dates[i - 1]!, 1));
      }
    });
  });

  describe("groups", () => {
    const base = { days: 7, quantities: qty({ m1: { "08:00": 4, "21:00": 4 } }) };

    it("places a dose a group claims once, not once for the medication and once for the group", () => {
      const r = run({ ...base, medications: [med("m1", ["08:00", "21:00"])], groups: [group("g1", ["08:00"], ["m1"])] });
      expect(r.placements.filter((p) => p.time === "08:00")).toHaveLength(7);
      expect(r.placements.filter((p) => p.time === "21:00")).toHaveLength(7);
      expect(r.problems).toEqual([]);
    });

    it("drops a claimed dose on days its group does not run, as the reminder does", () => {
      const r = run({
        ...base,
        medications: [med("m1", ["08:00", "21:00"])],
        groups: [group("g1", ["08:00"], ["m1"], { scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1] }) })],
      });
      expect(r.placements.filter((p) => p.time === "08:00").map((p) => p.date)).toEqual(["2026-10-05"]);
      // The unclaimed time is untouched.
      expect(r.placements.filter((p) => p.time === "21:00")).toHaveLength(7);
    });

    it("respects the group's own start and end dates", () => {
      const r = run({
        ...base,
        medications: [med("m1", ["08:00"])],
        groups: [group("g1", ["08:00"], ["m1"], { startDate: "2026-10-07", endDate: "2026-10-08" })],
      });
      expect(r.placements.map((p) => p.date)).toEqual(["2026-10-07", "2026-10-08"]);
    });

    it("applies the medication's own weekdays on top of the group's", () => {
      const r = run({
        ...base,
        medications: [med("m1", ["08:00"], { scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1, 2] }) })],
        groups: [group("g1", ["08:00"], ["m1"])],
      });
      expect(r.placements.map((p) => p.date)).toEqual(["2026-10-05", "2026-10-06"]);
    });

    it("ignores a disabled group, an interval group, a group the medication is not in, and a time the medication does not take", () => {
      const r = run({
        ...base,
        medications: [med("m1", ["08:00"])],
        groups: [
          group("off", ["08:00"], ["m1"], { enabled: false, scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1] }) }),
          // If this claimed 08:00 the dose would only exist on Mondays, so it must not.
          group("interval", ["08:00"], ["m1"], { scheduleKind: "interval", scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1] }) }),
          group("other", ["08:00"], ["someone-else"], { scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1] }) }),
          group("extra", ["12:00"], ["m1"]),
        ],
      });
      // Only the medication's own 08:00 applies, every day, and the group's 12:00 adds nothing.
      expect(r.placements.map((p) => p.time)).toEqual(Array(7).fill("08:00"));
    });

    it("reports two groups running the same dose on the same day once, as a warning, and places the dose once", () => {
      const r = run({
        ...base,
        medications: [med("m1", ["08:00"])],
        groups: [group("gB", ["08:00"], ["m1"]), group("gA", ["08:00"], ["m1"])],
      });
      expect(r.placements).toHaveLength(7);
      expect(r.problems).toEqual([{ kind: "double_claim", severity: "warning", medicationId: "m1", time: "08:00", groupIds: ["gA", "gB"] }]);
    });

    it("does not warn when the groups never run on the same day", () => {
      const r = run({
        ...base,
        medications: [med("m1", ["08:00"])],
        groups: [
          group("mon", ["08:00"], ["m1"], { scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1] }) }),
          group("tue", ["08:00"], ["m1"], { scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [2] }) }),
        ],
      });
      expect(r.placements.map((p) => p.date)).toEqual(["2026-10-05", "2026-10-06"]);
      expect(r.problems).toEqual([]);
    });
  });

  describe("what blocks filling", () => {
    it("reports a dose time with no compartment once, naming the medications, and places nothing for it", () => {
      const r = run({
        days: 3,
        medications: [med("b", ["13:00", "08:00"]), med("a", ["13:00"])],
        quantities: qty({ a: { "13:00": 4 }, b: { "13:00": 4, "08:00": 4 } }),
      });
      expect(r.problems).toEqual([{ kind: "unmapped_time", severity: "error", time: "13:00", medicationIds: ["a", "b"] }]);
      expect(r.placements.every((p) => p.time === "08:00")).toBe(true);
      expect(summary(r, "a")).toMatchObject({ doseCount: 3, placedCount: 0, complete: false });
      expect(summary(r, "b")).toMatchObject({ doseCount: 6, placedCount: 3, complete: false });
    });

    it("lists what blocks filling before warnings, grouped by kind", () => {
      const r = run({
        days: 2,
        medications: [med("a", ["08:00", "13:00"]), med("b", ["08:00"])],
        groups: [group("g1", ["08:00"], ["b"]), group("g2", ["08:00"], ["b"])],
        quantities: qty({ a: {}, b: { "08:00": 4 } }),
      });
      expect(r.problems.map((p) => `${p.severity}:${p.kind}`)).toEqual([
        "error:missing_quantity",
        "error:unmapped_time",
        "warning:double_claim",
      ]);
    });

    it("treats a time mapped to a compartment that no longer exists as unmapped", () => {
      const r = run({
        days: 1,
        medications: [med("m1", ["08:00"])],
        timeMap: new Map([["08:00", "deleted-compartment"]]),
        quantities: qty({ m1: { "08:00": 4 } }),
      });
      expect(r.problems).toEqual([{ kind: "unmapped_time", severity: "error", time: "08:00", medicationIds: ["m1"] }]);
      expect(r.placements).toEqual([]);
    });

    it("reports a missing quantity once per medication and time, not once per day", () => {
      const r = run({ days: 7, medications: [med("m1", ["08:00", "21:00"])], quantities: qty({ m1: { "21:00": 4 } }) });
      expect(r.problems).toEqual([{ kind: "missing_quantity", severity: "error", medicationId: "m1", time: "08:00" }]);
      expect(r.placements.filter((p) => p.time === "21:00")).toHaveLength(7);
      expect(summary(r, "m1")).toMatchObject({ doseCount: 14, placedCount: 7, complete: false });
    });

    it("does not accept a zero, negative or fractional-quarter quantity", () => {
      for (const bad of [0, -4, 1.5]) {
        const r = run({ days: 1, medications: [med("m1", ["08:00"])], quantities: qty({ m1: { "08:00": bad } }) });
        expect(r.placements, `quantity ${bad}`).toEqual([]);
        expect(r.problems, `quantity ${bad}`).toHaveLength(1);
      }
    });

    it("says nothing about a time that never falls in the days being filled", () => {
      // Sundays only, filled Monday to Saturday: no dose, so no unmapped time and no missing quantity.
      const r = run({
        days: 6,
        medications: [med("m1", ["13:00"], { scheduleJson: JSON.stringify({ times: ["13:00"], daysOfWeek: [0] }) })],
      });
      expect(r.problems).toEqual([]);
      expect(summary(r, "m1")).toMatchObject({ doseCount: 0, complete: true });
    });
  });

  describe("medications that are not guided", () => {
    it("lists as-needed, over-the-counter, interval, paused and time-less medications with the reason", () => {
      const r = run({
        days: 2,
        medications: [
          med("prn", [], { scheduleKind: "prn" }),
          med("otc", [], { scheduleKind: "otc" }),
          med("interval", [], { scheduleKind: "interval", scheduleJson: JSON.stringify({ everyMinutes: 240 }) }),
          med("paused", ["08:00"], { enabled: false }),
          med("empty", []),
          med("ok", ["08:00"]),
        ],
        quantities: qty({ ok: { "08:00": 4 } }),
      });
      expect(r.notGuided).toEqual([
        { medicationId: "empty", reason: "no_times" },
        { medicationId: "interval", reason: "interval" },
        { medicationId: "otc", reason: "over_the_counter" },
        { medicationId: "paused", reason: "paused" },
        { medicationId: "prn", reason: "as_needed" },
      ]);
      expect(r.byMedication.map((m) => m.medicationId)).toEqual(["ok"]);
      expect(r.problems).toEqual([]);
    });

    it("gives the kind as the reason for a paused as-needed medication, and leaves deleted ones out entirely", () => {
      const r = run({
        days: 1,
        medications: [med("prn", [], { scheduleKind: "prn", enabled: false }), med("gone", ["08:00"], { deletedAt: new Date() })],
      });
      expect(r.notGuided).toEqual([{ medicationId: "prn", reason: "as_needed" }]);
      expect(r.byMedication).toEqual([]);
    });

    it("leaves non-pill medications out of the organizer, with no quantity problem (WHO-445)", () => {
      const r = run({
        days: 2,
        medications: [
          med("iv", ["08:00", "20:00"], { form: "iv" }),
          med("shot", ["08:00"], { form: "injection", scheduleKind: "prn" }),
          med("pill", ["08:00"], { form: "pill" }),
          med("unset", ["08:00"]),
        ],
        quantities: qty({ pill: { "08:00": 4 }, unset: { "08:00": 4 } }),
      });
      expect(r.notGuided).toEqual([
        { medicationId: "iv", reason: "not_a_pill" },
        { medicationId: "shot", reason: "not_a_pill" },
      ]);
      expect(r.problems).toEqual([]);
      expect(r.byMedication.map((m) => m.medicationId)).toEqual(["pill", "unset"]);
      expect(r.placements.every((pl) => pl.medicationId === "pill" || pl.medicationId === "unset")).toBe(true);
    });

    it("ignores unusable times: bad formats, out of range, seconds are trimmed and repeats collapse", () => {
      const r = run({
        days: 1,
        medications: [med("m1", ["08:00:30", "8:00", "25:00", "08:60", "noon", "08:00", "21:00"]), med("junk", ["8:00", "noon"])],
        quantities: qty({ m1: { "08:00": 4, "21:00": 4 } }),
      });
      expect(r.placements.map((p) => p.time)).toEqual(["08:00", "21:00"]);
      expect(r.notGuided).toEqual([{ medicationId: "junk", reason: "no_times" }]);
    });

    it("reads a time stored with seconds as that minute", () => {
      const r = run({ days: 1, medications: [med("secs", ["08:00:00"])], quantities: qty({ secs: { "08:00": 4 } }) });
      expect(r.placements).toEqual([{ medicationId: "secs", date: MON, time: "08:00", compartmentId: MORNING.id, quarters: 4 }]);
    });

    it("copes with a malformed schedule", () => {
      const r = run({ days: 1, medications: [med("bad", [], { scheduleJson: "{not json" }), med("nul", [], { scheduleJson: null })] });
      expect(r.notGuided.map((n) => n.reason)).toEqual(["no_times", "no_times"]);
    });
  });

  describe("input checks", () => {
    const m = [med("m1", ["08:00"])];
    it("refuses a range that is not 1 to 93 whole days", () => {
      for (const days of [0, -1, 1.5, MAX_ORGANIZER_DAYS + 1, Number.NaN]) {
        expect(() => run({ days, medications: m }), `days ${days}`).toThrow(RangeError);
      }
      expect(run({ days: MAX_ORGANIZER_DAYS, medications: m }).days).toBe(93);
      expect(run({ days: 1, medications: m }).to).toBe(MON);
    });

    it("refuses a start that is not a real calendar date, and says which kind of wrong it is", () => {
      for (const from of ["10/05/2026", "", "2026-1-5", "tomorrow"]) {
        expect(() => run({ from, medications: m }), from).toThrow(/YYYY-MM-DD/);
      }
      for (const from of ["2026-13-40", "2026-02-30", "2026-00-10"]) {
        expect(() => run({ from, medications: m }), from).toThrow(/calendar date/);
      }
    });
  });

  describe("the fingerprint", () => {
    const inputs = (): PlacementInput => ({
      from: MON,
      days: 7,
      medications: [med("m1", ["08:00", "21:00"]), med("m2", ["12:00"])],
      groups: [group("g1", ["08:00"], ["m1"])],
      compartments: COMPARTMENTS,
      timeMap: TIME_MAP,
      quantities: qty({ m1: { "08:00": 4, "21:00": 6 }, m2: { "12:00": 2 } }),
    });
    const hash = (over: Partial<PlacementInput> = {}) => computePlacements({ ...inputs(), ...over }).hash;

    it("is the same for the same instructions, whatever order the inputs come in", () => {
      const a = inputs();
      const reordered: PlacementInput = {
        ...a,
        medications: [...a.medications].reverse(),
        compartments: [...a.compartments].reverse(),
        timeMap: new Map([...a.timeMap.entries()].reverse()),
      };
      expect(hash(reordered)).toBe(hash());
      expect(hash()).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is the same whatever order problems, non-guided medications and groups arrive in", () => {
      const messy = (reverse: boolean): PlacementInput => {
        const medications = [
          med("m1", ["08:00", "13:00"]),
          med("m2", ["13:00", "09:30"]),
          med("m3", ["21:00"]),
          med("prn", [], { scheduleKind: "prn" }),
          med("paused", ["08:00"], { enabled: false }),
          med("empty", []),
        ];
        const groups = [group("gA", ["08:00"], ["m1"]), group("gB", ["08:00"], ["m1"])];
        return {
          ...inputs(),
          medications: reverse ? [...medications].reverse() : medications,
          groups: reverse ? [...groups].reverse() : groups,
          // m1 and m3 have quantities for some times only, so there are missing-quantity problems too.
          quantities: qty({ m1: { "08:00": 4 }, m3: {} }),
        };
      };
      const forward = computePlacements(messy(false));
      expect(forward.problems.length).toBeGreaterThan(3);
      expect(forward.notGuided).toHaveLength(3);
      expect(computePlacements(messy(true)).hash).toBe(forward.hash);
    });

    it("changes when anything that changes what a person is told to do changes", () => {
      const base = hash();
      const a = inputs();
      const changed: Array<[string, Partial<PlacementInput>]> = [
        ["a quantity", { quantities: qty({ m1: { "08:00": 4, "21:00": 8 }, m2: { "12:00": 2 } }) }],
        ["a missing quantity", { quantities: qty({ m1: { "08:00": 4 }, m2: { "12:00": 2 } }) }],
        ["which compartment a time is in", { timeMap: new Map([...TIME_MAP, ["12:00", SUPPER.id]]) }],
        ["a time with no compartment", { timeMap: new Map([...TIME_MAP].filter(([t]) => t !== "21:00")) }],
        ["a compartment name", { compartments: [{ ...MORNING, name: "Breakfast" }, LUNCH, SUPPER, NIGHT] }],
        ["compartment order", { compartments: [{ ...MORNING, position: 3 }, LUNCH, SUPPER, { ...NIGHT, position: 0 }] }],
        ["a medication's times", { medications: [med("m1", ["08:00", "21:00", "12:00"]), a.medications[1]!] }],
        ["a medication's weekdays", { medications: [med("m1", ["08:00", "21:00"], { scheduleJson: JSON.stringify({ times: ["08:00", "21:00"], daysOfWeek: [1] }) }), a.medications[1]!] }],
        ["a medication being paused", { medications: [med("m1", ["08:00", "21:00"], { enabled: false }), a.medications[1]!] }],
        ["a group running fewer days", { groups: [group("g1", ["08:00"], ["m1"], { scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1] }) })] }],
        ["the first day", { from: "2026-10-06" }],
        ["the number of days", { days: 8 }],
      ];
      for (const [label, over] of changed) expect(hash(over), label).not.toBe(base);
    });

    it("tells ranges apart even when nothing is placed in them", () => {
      const none = (over: Partial<PlacementInput>) => computePlacements({ ...inputs(), medications: [], groups: [], ...over }).hash;
      expect(none({ from: "2026-10-05" })).not.toBe(none({ from: "2026-10-06" }));
      expect(none({ days: 7 })).not.toBe(none({ days: 8 }));
    });

    it("does not change for things that do not affect the instructions", () => {
      const a = inputs();
      // Mapping a time no medication takes.
      expect(hash({ timeMap: new Map([...TIME_MAP, ["03:00", NIGHT.id]]) })).toBe(hash());
      // Whether a group that cannot claim anything exists, and an unrelated medication's id order.
      expect(hash({ groups: [...a.groups, group("x", ["08:00"], ["nobody"])] })).toBe(hash());
      // Quantities for times a medication does not take.
      expect(hash({ quantities: qty({ m1: { "08:00": 4, "21:00": 6, "13:00": 4 }, m2: { "12:00": 2 } }) })).toBe(hash());
    });
  });
});

describe("addDaysUtc", () => {
  it("moves by days across month, leap and year ends, in either direction", () => {
    expect(addDaysUtc("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysUtc("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysUtc("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysUtc("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysUtc("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysUtc("2026-03-08", 0)).toBe("2026-03-08");
    expect(addDaysUtc("2026-01-01", 365)).toBe("2027-01-01");
  });

  it("refuses a date that is not on the calendar", () => {
    expect(() => addDaysUtc("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("formatQuarters", () => {
  it("writes quarters of a pill the way people say them", () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 400].map(formatQuarters),
    ).toEqual(["0", "¼", "½", "¾", "1", "1¼", "1½", "1¾", "2", "2½", "3", "100"]);
  });

  it("refuses anything that is not a whole number of quarters", () => {
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => formatQuarters(bad)).toThrow(RangeError);
  });
});
