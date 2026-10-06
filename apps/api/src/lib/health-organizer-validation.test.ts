import { describe, expect, it } from "vitest";
import {
  OrganizerValidationError,
  parseAnchorDate,
  parseCaregivers,
  parseCompartments,
  parseFillLength,
  parseGroupAssignment,
  parseNewCompartmentNames,
  parseReminderTime,
  parseTimeMap,
  parseVersion,
  resolveSchedule,
  type PlanSchedule,
} from "./health-organizer-validation.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof OrganizerValidationError) return e.code;
    throw e;
  }
  return "no error";
}

describe("resolveSchedule", () => {
  const every10: PlanSchedule = { scheduleKind: "every_n_days", everyN: 10, monthlyDay: null };
  const monthly15: PlanSchedule = { scheduleKind: "monthly_date", monthlyDay: 15, everyN: null };

  it("builds each kind from scratch", () => {
    expect(resolveSchedule(null, { scheduleKind: "every_n_days", everyN: 30 })).toEqual({ scheduleKind: "every_n_days", everyN: 30, monthlyDay: null });
    expect(resolveSchedule(null, { scheduleKind: "monthly_date", monthlyDay: 31 })).toEqual({ scheduleKind: "monthly_date", monthlyDay: 31, everyN: null });
  });

  it("keeps what the plan has for anything not sent, and drops the other kind's number on a switch", () => {
    expect(resolveSchedule(every10, { everyN: 7 })).toEqual({ scheduleKind: "every_n_days", everyN: 7, monthlyDay: null });
    expect(resolveSchedule(every10, {})).toEqual(every10);
    expect(resolveSchedule(every10, { scheduleKind: "monthly_date", monthlyDay: 1 })).toEqual({ scheduleKind: "monthly_date", monthlyDay: 1, everyN: null });
    expect(resolveSchedule(monthly15, { scheduleKind: "every_n_days", everyN: 2, monthlyDay: 9 })).toEqual({ scheduleKind: "every_n_days", everyN: 2, monthlyDay: null });
  });

  it("refuses a switch that does not bring the new kind's number", () => {
    expect(codeOf(() => resolveSchedule(monthly15, { scheduleKind: "every_n_days" }))).toBe("invalid_every_n");
    expect(codeOf(() => resolveSchedule(every10, { scheduleKind: "monthly_date" }))).toBe("invalid_monthly_day");
  });

  it("limits the numbers", () => {
    for (const bad of [0, -1, 366, 1.5, "7", null]) expect(codeOf(() => resolveSchedule(null, { scheduleKind: "every_n_days", everyN: bad })), String(bad)).toBe("invalid_every_n");
    for (const bad of [0, 32, 2.5, "7", null]) expect(codeOf(() => resolveSchedule(null, { scheduleKind: "monthly_date", monthlyDay: bad })), String(bad)).toBe("invalid_monthly_day");
    expect(resolveSchedule(null, { scheduleKind: "every_n_days", everyN: 365 }).everyN).toBe(365);
    expect(resolveSchedule(null, { scheduleKind: "every_n_days", everyN: 1 }).everyN).toBe(1);
  });

  it("refuses an unknown or missing kind", () => {
    for (const bad of ["weekly", "", 5, null, undefined]) expect(codeOf(() => resolveSchedule(null, { scheduleKind: bad })), String(bad)).toBe("invalid_schedule_kind");
  });
});

describe("parseAnchorDate", () => {
  it("accepts real days, leap day included", () => {
    expect(parseAnchorDate("2026-10-06")).toBe("2026-10-06");
    expect(parseAnchorDate("2028-02-29")).toBe("2028-02-29");
  });

  it("refuses everything else", () => {
    for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-10-32", "26-10-06", "2026-1-6", "2026/10/06", "", null, 20261006, "2026-10-06T00:00:00Z"]) {
      expect(codeOf(() => parseAnchorDate(bad)), String(bad)).toBe("invalid_anchor_date");
    }
  });
});

describe("parseFillLength", () => {
  it("accepts 1 to 93 days", () => {
    expect(parseFillLength(1)).toBe(1);
    expect(parseFillLength(31)).toBe(31);
    expect(parseFillLength(93)).toBe(93);
  });

  it("refuses the rest", () => {
    for (const bad of [0, 94, -5, 31.5, "31", null, undefined]) expect(codeOf(() => parseFillLength(bad)), String(bad)).toBe("invalid_fill_length");
  });
});

describe("parseReminderTime", () => {
  it("returns HH:MM", () => {
    expect(parseReminderTime("09:00")).toBe("09:00");
    expect(parseReminderTime("09:00:00")).toBe("09:00");
    expect(parseReminderTime(" 23:59 ")).toBe("23:59");
    expect(parseReminderTime("00:00")).toBe("00:00");
  });

  it("refuses seconds, 24:00 and non-times", () => {
    for (const bad of ["9:00", "24:00", "09:60", "09:00:30", "0900", "", null, 900]) expect(codeOf(() => parseReminderTime(bad)), String(bad)).toBe("invalid_reminder_time");
  });
});

describe("parseCompartments", () => {
  it("keeps order, trims names and tells existing from new", () => {
    expect(parseCompartments([{ id: A, name: "  Morning " }, { name: "Night" }])).toEqual([
      { id: A, name: "Morning" },
      { id: null, name: "Night" },
    ]);
  });

  it("limits the count to 1..8", () => {
    expect(codeOf(() => parseCompartments([]))).toBe("invalid_compartments");
    expect(codeOf(() => parseCompartments("Morning"))).toBe("invalid_compartments");
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `c${i}` }));
    expect(codeOf(() => parseCompartments(nine))).toBe("too_many_compartments");
    expect(parseCompartments(nine.slice(0, 8))).toHaveLength(8);
  });

  it("limits and de-duplicates names", () => {
    expect(codeOf(() => parseCompartments([{ name: "   " }]))).toBe("invalid_compartment_name");
    expect(codeOf(() => parseCompartments([{ name: "x".repeat(41) }]))).toBe("invalid_compartment_name");
    expect(codeOf(() => parseCompartments([{}]))).toBe("invalid_compartment_name");
    expect(codeOf(() => parseCompartments([{ name: 5 }]))).toBe("invalid_compartment_name");
    expect(parseCompartments([{ name: "x".repeat(40) }])).toHaveLength(1);
    expect(codeOf(() => parseCompartments([{ name: "Morning" }, { name: " morning " }]))).toBe("duplicate_compartment_name");
  });

  it("refuses bad or repeated ids and non-objects", () => {
    expect(codeOf(() => parseCompartments([{ id: "nope", name: "a" }]))).toBe("compartment_not_found");
    expect(codeOf(() => parseCompartments([{ id: A, name: "a" }, { id: A, name: "b" }]))).toBe("compartment_not_found");
    expect(codeOf(() => parseCompartments([null]))).toBe("invalid_compartments");
    expect(codeOf(() => parseCompartments([["a"]]))).toBe("invalid_compartments");
  });
});

describe("parseNewCompartmentNames", () => {
  it("defaults to four named for the day", () => {
    expect(parseNewCompartmentNames(undefined)).toEqual(["Morning", "Lunch", "Supper", "Night"]);
  });

  it("uses the names given, with the same limits", () => {
    expect(parseNewCompartmentNames(["AM", "PM"])).toEqual(["AM", "PM"]);
    expect(codeOf(() => parseNewCompartmentNames(["AM", "am"]))).toBe("duplicate_compartment_name");
    expect(codeOf(() => parseNewCompartmentNames([]))).toBe("invalid_compartments");
    expect(codeOf(() => parseNewCompartmentNames("AM"))).toBe("invalid_compartments");
  });
});

describe("parseTimeMap", () => {
  it("normalises times and ids", () => {
    const map = parseTimeMap({ "08:00:00": A.toUpperCase(), "21:30": B });
    expect([...map]).toEqual([["08:00", A], ["21:30", B]]);
  });

  it("accepts an empty map (clears it)", () => {
    expect(parseTimeMap({}).size).toBe(0);
  });

  it("refuses bad times, ids, duplicates and shapes", () => {
    for (const bad of [{ "8:00": A }, { "08:00:30": A }, { "08:00": "nope" }, { "08:00": null }, { "08:00": 5 }, { "08:00": A, "08:00:00": B }, [], null, "x"]) {
      expect(codeOf(() => parseTimeMap(bad)), JSON.stringify(bad)).toBe("invalid_time_map");
    }
  });
});

describe("parseCaregivers", () => {
  it("returns distinct ids, and an empty list is fine", () => {
    expect(parseCaregivers([A, A.toUpperCase(), B])).toEqual([A, B]);
    expect(parseCaregivers([])).toEqual([]);
  });

  it("refuses non-ids, non-lists and more than 20", () => {
    expect(codeOf(() => parseCaregivers(["nope"]))).toBe("invalid_caregivers");
    expect(codeOf(() => parseCaregivers(A))).toBe("invalid_caregivers");
    expect(codeOf(() => parseCaregivers(null))).toBe("invalid_caregivers");
    const many = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(codeOf(() => parseCaregivers(many))).toBe("invalid_caregivers");
    expect(parseCaregivers(many.slice(0, 20))).toHaveLength(20);
  });
});

describe("parseGroupAssignment", () => {
  it("reads both ids", () => {
    expect(parseGroupAssignment({ groupId: A, compartmentId: B })).toEqual({ groupId: A, compartmentId: B });
  });

  it("refuses a missing or bad id", () => {
    for (const bad of [{ groupId: A }, { compartmentId: B }, { groupId: "x", compartmentId: B }, null, [], "x"]) {
      expect(codeOf(() => parseGroupAssignment(bad)), JSON.stringify(bad)).toBe("invalid_group_assignment");
    }
  });
});

describe("parseVersion", () => {
  it("wants a positive whole number", () => {
    expect(parseVersion(1)).toBe(1);
    for (const bad of [0, -1, 1.5, "1", null, undefined]) expect(codeOf(() => parseVersion(bad)), String(bad)).toBe("invalid_version");
  });
});
