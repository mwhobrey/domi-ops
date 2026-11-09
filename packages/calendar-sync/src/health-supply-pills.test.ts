import { describe, expect, it } from "vitest";
import { addDaysUtc, type OrganizerGroup, type OrganizerMedication } from "./health-organizer-placements.js";
import { bridgeDoseFreeDays, outsideQuartersAfterFill, pillDoseSchedule, quartersToDays, quartersUsedByFill } from "./health-supply-pills.js";

// 2026-11-09 is a Monday.
const MONDAY = "2026-11-09";
const SATURDAY = "2026-11-14";

const med = (over: Partial<OrganizerMedication> = {}): OrganizerMedication => ({
  id: "m1",
  scheduleKind: "scheduled",
  scheduleJson: JSON.stringify({ times: ["08:00"] }),
  startDate: null,
  endDate: null,
  enabled: true,
  ...over,
});
const weekdays = JSON.stringify({ times: ["08:00"], daysOfWeek: [1, 2, 3, 4, 5] });
const q = (entries: Record<string, number>) => new Map(Object.entries(entries));
const onePill = q({ "08:00": 4 });

function schedule(over: Partial<OrganizerMedication> = {}, quantities = onePill, groups: OrganizerGroup[] = []) {
  const s = pillDoseSchedule(med(over), groups, quantities);
  if (!s) throw new Error("expected a fixed dose");
  return s;
}

describe("pillDoseSchedule", () => {
  it.each([
    ["as needed", { scheduleKind: "prn" as const }],
    ["over the counter", { scheduleKind: "otc" as const }],
    ["interval", { scheduleKind: "interval" as const }],
    ["a liquid", { form: "liquid" as const }],
    ["no times", { scheduleJson: "{}" }],
    ["deleted", { deletedAt: new Date() }],
  ])("has no fixed dose when %s", (_name, over) => {
    expect(pillDoseSchedule(med(over), [], onePill)).toBeNull();
  });

  it("has no fixed dose with no quantities, or with one time missing its quantity", () => {
    expect(pillDoseSchedule(med(), [], undefined)).toBeNull();
    expect(pillDoseSchedule(med({ scheduleJson: JSON.stringify({ times: ["08:00", "20:00"] }) }), [], onePill)).toBeNull();
  });

  it("still counts for a paused medication and one kept out of the organizer", () => {
    expect(pillDoseSchedule(med({ enabled: false }), [], onePill)).not.toBeNull();
    expect(pillDoseSchedule(med({ organizerExcluded: true }), [], onePill)).not.toBeNull();
  });

  it("adds up every dose time on a day", () => {
    const s = schedule({ scheduleJson: JSON.stringify({ times: ["08:00", "20:00"] }) }, q({ "08:00": 4, "20:00": 2 }));
    expect(s.quartersOn(MONDAY)).toBe(6);
  });

  it("drops a time claimed by a group on the days that group does not run", () => {
    const group: OrganizerGroup = {
      id: "g1",
      scheduleKind: "scheduled",
      scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1] }),
      startDate: null,
      endDate: null,
      enabled: true,
      medicationIds: ["m1"],
    };
    const s = schedule({}, onePill, [group]);
    expect(s.quartersOn(MONDAY)).toBe(4);
    expect(s.quartersOn(addDaysUtc(MONDAY, 1))).toBe(0);
  });
});

describe("quartersToDays", () => {
  it("is one day per daily dose", () => {
    expect(quartersToDays(schedule(), MONDAY, 30 * 4)).toBe(30);
  });

  it("is nothing for no pills on a day with a dose", () => {
    expect(quartersToDays(schedule(), MONDAY, 0)).toBe(0);
  });

  it("rounds a part of a day down", () => {
    expect(quartersToDays(schedule(), MONDAY, 22)).toBe(5); // 5½ pills at one a day
    expect(quartersToDays(schedule({}, q({ "08:00": 8 })), MONDAY, 12)).toBe(1); // 3 pills at two a day
  });

  it("counts a day only when all of that day's doses can be met", () => {
    const twice = schedule({ scheduleJson: JSON.stringify({ times: ["08:00", "20:00"] }) }, q({ "08:00": 4, "20:00": 4 }));
    expect(quartersToDays(twice, MONDAY, 3 * 4)).toBe(1);
  });

  it("handles half pills exactly", () => {
    expect(quartersToDays(schedule({}, q({ "08:00": 2 })), MONDAY, 10 * 4)).toBe(20);
  });

  it("walks the real week for a weekday medication", () => {
    const s = schedule({ scheduleJson: weekdays });
    expect(quartersToDays(s, MONDAY, 5 * 4)).toBe(7); // Monday to Friday, then nothing due until the next Monday
    expect(quartersToDays(s, MONDAY, 4 * 4)).toBe(4); // gone by Friday
    expect(quartersToDays(s, MONDAY, 6 * 4)).toBe(8);
  });

  it("does not spend a pill on the weekend it starts on", () => {
    const s = schedule({ scheduleJson: weekdays });
    expect(quartersToDays(s, SATURDAY, 0)).toBe(2); // nothing is due until Monday
    expect(quartersToDays(s, SATURDAY, 1 * 4)).toBe(3);
  });

  it("does not spend pills before the medication starts", () => {
    expect(quartersToDays(schedule({ startDate: addDaysUtc(MONDAY, 3) }), MONDAY, 2 * 4)).toBe(5);
  });

  it("stops the day after the medication ends, however many are left", () => {
    expect(quartersToDays(schedule({ endDate: addDaysUtc(MONDAY, 9) }), MONDAY, 500 * 4)).toBe(10);
  });

  it("is nothing when the medication ended before the pills are needed", () => {
    expect(quartersToDays(schedule({ endDate: addDaysUtc(MONDAY, -1) }), MONDAY, 40)).toBe(0);
  });

  it("refuses a count that lasts past the longest supply", () => {
    expect(quartersToDays(schedule(), MONDAY, 3650 * 4)).toBe(3650);
    expect(() => quartersToDays(schedule(), MONDAY, 3651 * 4)).toThrow(RangeError);
  });

  it.each([-1, 1.5])("refuses %s quarters", (bad) => {
    expect(() => quartersToDays(schedule(), MONDAY, bad)).toThrow(RangeError);
  });
});

describe("bridgeDoseFreeDays", () => {
  const plus = (n: number) => addDaysUtc(MONDAY, n);
  const week = () => schedule({ scheduleJson: weekdays });

  it("joins fills across a weekend", () => {
    expect(bridgeDoseFreeDays([{ from: plus(0), to: plus(4) }, { from: plus(7), to: plus(11) }], week(), plus(0))).toEqual([{ from: plus(0), to: plus(11) }]);
  });

  it("treats a fill that starts after dose-free days as starting today", () => {
    expect(bridgeDoseFreeDays([{ from: plus(0), to: plus(4) }], week(), plus(-1))).toEqual([{ from: plus(-1), to: plus(4) }]);
  });

  it("keeps a real gap, where a dose falls in the hole", () => {
    const ranges = [{ from: plus(0), to: plus(1) }, { from: plus(4), to: plus(4) }];
    expect(bridgeDoseFreeDays(ranges, week(), plus(0))).toEqual(ranges);
  });

  it("keeps a fill that starts after a day with a dose as not started", () => {
    const ranges = [{ from: plus(2), to: plus(4) }];
    expect(bridgeDoseFreeDays(ranges, schedule(), plus(0))).toEqual(ranges);
  });

  it("does not stretch past the last day filled", () => {
    expect(bridgeDoseFreeDays([{ from: plus(0), to: plus(4) }], week(), plus(0))).toEqual([{ from: plus(0), to: plus(4) }]);
  });

  it("forgets what is already over", () => {
    expect(bridgeDoseFreeDays([{ from: plus(-9), to: plus(-5) }, { from: plus(0), to: plus(4) }], week(), plus(0))).toEqual([{ from: plus(0), to: plus(4) }]);
  });
});

describe("quartersUsedByFill", () => {
  const doses = [
    { date: "2026-11-09", quarters: 4 },
    { date: "2026-11-09", quarters: 2 },
    { date: "2026-11-10", quarters: 6 },
    { date: "2026-11-11", quarters: 6 },
  ];

  it("adds the doses in the days filled", () => {
    expect(quartersUsedByFill(doses, [], { from: "2026-11-09", to: "2026-11-10" })).toBe(12);
  });

  it("does not count days already in the organizers", () => {
    expect(quartersUsedByFill(doses, [{ from: "2026-11-09", to: "2026-11-09" }], { from: "2026-11-09", to: "2026-11-11" })).toBe(12);
  });
});

describe("outsideQuartersAfterFill", () => {
  it("takes what the fill used from the last count", () => {
    expect(outsideQuartersAfterFill(240, 124)).toBe(116);
  });

  it("stops at nothing", () => {
    expect(outsideQuartersAfterFill(40, 124)).toBe(0);
  });

  it("has nothing to say without a count", () => {
    expect(outsideQuartersAfterFill(null, 124)).toBeNull();
  });
});
