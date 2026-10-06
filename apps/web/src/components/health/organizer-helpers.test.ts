import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/client-api";
import {
  formatPills,
  groupTimes,
  notGuidedReasonLabel,
  organizerErrorMessage,
  parseQuantityInput,
  scheduleSummary,
  setupChecklist,
  stepQuantity,
  suggestGroupMappings,
} from "./organizer-helpers";
import type { OrganizerPlan } from "./organizer-types";

describe("parseQuantityInput", () => {
  it("reads whole numbers and decimals in quarter steps", () => {
    for (const [text, pills] of [["1", 1], ["2", 2], ["1.5", 1.5], [".5", 0.5], ["0.25", 0.25], ["0.75", 0.75], ["10.25", 10.25], [" 3 ", 3], ["100", 100]] as const) {
      expect(parseQuantityInput(text), text).toEqual({ ok: true, pills });
    }
  });

  it("reads fractions and mixed numbers", () => {
    for (const [text, pills] of [["1/2", 0.5], ["1/4", 0.25], ["3/4", 0.75], ["1 1/2", 1.5], ["2 3/4", 2.75], ["2/4", 0.5], ["4/4", 1], ["6/4", 1.5], ["1  1/2", 1.5]] as const) {
      expect(parseQuantityInput(text), text).toEqual({ ok: true, pills });
    }
  });

  it("reads the fraction characters, alone or after a whole number", () => {
    for (const [text, pills] of [["½", 0.5], ["¼", 0.25], ["¾", 0.75], ["1½", 1.5], ["1 ½", 1.5], ["2¾", 2.75]] as const) {
      expect(parseQuantityInput(text), text).toEqual({ ok: true, pills });
    }
  });

  it("refuses anything that is not a whole number of quarters", () => {
    for (const text of ["0.3", "1/3", "2/3", "0.1", "1.9", "1 1/3", "5/8", "0.26"]) {
      expect(parseQuantityInput(text), text).toEqual({ ok: false, reason: "not_quarter" });
    }
  });

  it("refuses nothing, words and nonsense", () => {
    expect(parseQuantityInput("")).toEqual({ ok: false, reason: "empty" });
    expect(parseQuantityInput("   ")).toEqual({ ok: false, reason: "empty" });
    for (const text of ["abc", "1,5", "-1", "1.", ".", "1/", "/2", "1/2/3", "one", "1e1", "1 2", "½½"]) {
      expect(parseQuantityInput(text).ok, text).toBe(false);
    }
    expect(parseQuantityInput("1/0")).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps to a quarter and a hundred pills", () => {
    expect(parseQuantityInput("0")).toEqual({ ok: false, reason: "range" });
    expect(parseQuantityInput("100.25")).toEqual({ ok: false, reason: "range" });
    expect(parseQuantityInput("1000")).toEqual({ ok: false, reason: "range" });
    expect(parseQuantityInput("0.25")).toEqual({ ok: true, pills: 0.25 });
    expect(parseQuantityInput("100")).toEqual({ ok: true, pills: 100 });
  });
});

describe("formatPills", () => {
  it("shows quarters the way people say them", () => {
    expect(formatPills(1)).toBe("1");
    expect(formatPills(1.5)).toBe("1½");
    expect(formatPills(0.25)).toBe("¼");
    expect(formatPills(0.5)).toBe("½");
    expect(formatPills(0.75)).toBe("¾");
    expect(formatPills(2.75)).toBe("2¾");
    expect(formatPills(10)).toBe("10");
  });

  it("rounds to the nearest quarter and round-trips through the parser", () => {
    expect(formatPills(1.49)).toBe("1½");
    for (let q = 1; q <= 40; q++) {
      const pills = q / 4;
      expect(parseQuantityInput(formatPills(pills)), String(pills)).toEqual({ ok: true, pills });
    }
  });
});

describe("stepQuantity", () => {
  it("starts at one pill going up, and stays empty going down", () => {
    expect(stepQuantity(null, 1)).toBe(1);
    expect(stepQuantity(null, -1)).toBeNull();
  });

  it("moves a quarter at a time within the limits", () => {
    expect(stepQuantity(1, 1)).toBe(1.25);
    expect(stepQuantity(1, -1)).toBe(0.75);
    expect(stepQuantity(0.25, -1)).toBe(0.25);
    expect(stepQuantity(100, 1)).toBe(100);
    expect(stepQuantity(99.75, 1)).toBe(100);
  });
});

const comp = (id: string, name: string, position: number) => ({ id, name, position });
const group = (id: string, name: string, times: string[], over: Partial<{ scheduleKind: string; enabled: boolean }> = {}) => ({
  id,
  name,
  scheduleKind: "scheduled",
  enabled: true,
  schedule: { times },
  ...over,
});

describe("groupTimes", () => {
  it("lists the times of a scheduled group as HH:MM, sorted, once each", () => {
    expect(groupTimes(group("g", "x", ["21:00:00", "08:00", "08:00:00"]))).toEqual(["08:00", "21:00"]);
  });

  it("has none for an interval group or a bad schedule", () => {
    expect(groupTimes(group("g", "x", ["08:00"], { scheduleKind: "interval" }))).toEqual([]);
    expect(groupTimes({ ...group("g", "x", []), schedule: { times: "08:00" } })).toEqual([]);
    expect(groupTimes({ ...group("g", "x", []), schedule: {} })).toEqual([]);
  });
});

describe("suggestGroupMappings", () => {
  const compartments = [comp("c1", "Morning", 0), comp("c2", "Lunch", 1), comp("c3", "Supper", 2), comp("c4", "Night", 3)];

  it("matches groups to compartments of the same name, ignoring case and spaces", () => {
    const groups = [group("g1", "morning", ["07:30", "08:00"]), group("g2", " LUNCH ", ["12:00"]), group("g3", "Other", ["15:00"])];
    expect(suggestGroupMappings(groups, compartments, {})).toEqual([
      { compartmentId: "c1", compartmentName: "Morning", groupId: "g1", groupName: "morning", times: ["07:30", "08:00"] },
      { compartmentId: "c2", compartmentName: "Lunch", groupId: "g2", groupName: " LUNCH ", times: ["12:00"] },
    ]);
  });

  it("stops suggesting a group whose times are already all in its compartment", () => {
    const groups = [group("g1", "Morning", ["08:00"]), group("g2", "Lunch", ["12:00", "12:30"])];
    const mapped = suggestGroupMappings(groups, compartments, { "08:00": "c1", "12:00": "c2" });
    expect(mapped.map((s) => s.groupId)).toEqual(["g2"]);
    expect(suggestGroupMappings(groups, compartments, { "08:00": "c1", "12:00": "c2", "12:30": "c2" })).toEqual([]);
    // the same time in a different compartment is still worth suggesting
    expect(suggestGroupMappings(groups, compartments, { "08:00": "c4" }).map((s) => s.groupId)).toContain("g1");
  });

  it("skips groups that are off, have no fixed times or match nothing", () => {
    const groups = [group("g1", "Morning", ["08:00"], { enabled: false }), group("g2", "Lunch", [], {}), group("g3", "Supper", ["18:00"], { scheduleKind: "interval" })];
    expect(suggestGroupMappings(groups, compartments, {})).toEqual([]);
    expect(suggestGroupMappings([], compartments, {})).toEqual([]);
  });
});

describe("scheduleSummary", () => {
  it("says how often, from when", () => {
    expect(scheduleSummary({ scheduleKind: "every_n_days", everyN: 30, monthlyDay: null, anchorDate: "2026-10-06" })).toBe("Every 30 days, starting Oct 6");
    expect(scheduleSummary({ scheduleKind: "every_n_days", everyN: 1, monthlyDay: null, anchorDate: "2026-10-06" })).toBe("Every day, starting Oct 6");
  });

  it("says a monthly date with the right ordinal, and what happens in a short month", () => {
    const monthly = (monthlyDay: number) => scheduleSummary({ scheduleKind: "monthly_date", everyN: null, monthlyDay, anchorDate: "2026-10-06" });
    expect(monthly(1)).toBe("On the 1st of each month");
    expect(monthly(2)).toBe("On the 2nd of each month");
    expect(monthly(3)).toBe("On the 3rd of each month");
    expect(monthly(11)).toBe("On the 11th of each month");
    expect(monthly(12)).toBe("On the 12th of each month");
    expect(monthly(13)).toBe("On the 13th of each month");
    expect(monthly(21)).toBe("On the 21st of each month");
    expect(monthly(22)).toBe("On the 22nd of each month");
    expect(monthly(28)).toBe("On the 28th of each month");
    expect(monthly(29)).toBe("On the 29th of each month (the last day in shorter months)");
    expect(monthly(31)).toBe("On the 31st of each month (the last day in shorter months)");
  });
});

describe("setupChecklist", () => {
  const plan = (setup: Partial<OrganizerPlan["setup"]>): OrganizerPlan => ({
    id: "p",
    memberId: "m",
    scheduleKind: "every_n_days",
    everyN: 30,
    monthlyDay: null,
    anchorDate: "2026-10-06",
    fillLengthDays: 31,
    reminderTime: "09:00",
    version: 1,
    compartments: [],
    timeMap: {},
    caregiverMemberIds: [],
    setup: { doseTimes: ["08:00"], problems: [], notGuided: [], ready: false, ...setup },
    canEdit: true,
  });
  const meds = [{ id: "m1", name: "Lisinopril" }, { id: "m2", name: "Metformin" }];

  it("is ready when there is nothing in the way", () => {
    expect(setupChecklist(plan({ ready: true }), meds)).toEqual([{ key: "ready", status: "ok", title: "Ready to fill" }]);
  });

  it("sends unmapped times to the times step", () => {
    const items = setupChecklist(plan({ problems: [{ kind: "unmapped_time", severity: "error", time: "13:00", medicationIds: ["m1"] }, { kind: "unmapped_time", severity: "error", time: "21:00", medicationIds: ["m2"] }] }), meds);
    expect(items).toEqual([{ key: "times", status: "todo", title: "2 dose times have no compartment", detail: "13:00, 21:00", step: "times" }]);
    expect(setupChecklist(plan({ problems: [{ kind: "unmapped_time", severity: "error", time: "13:00", medicationIds: ["m1"] }] }), meds)[0]!.title).toBe("1 dose time has no compartment");
  });

  it("sends missing quantities to the pills step, naming each medication and time", () => {
    const items = setupChecklist(
      plan({
        problems: [
          { kind: "missing_quantity", severity: "error", medicationId: "m1", time: "08:00" },
          { kind: "missing_quantity", severity: "error", medicationId: "m1", time: "21:00" },
          { kind: "missing_quantity", severity: "error", medicationId: "m2", time: "12:00" },
        ],
      }),
      meds,
    );
    expect(items).toEqual([
      { key: "quantities", status: "todo", title: "Pill amounts are missing for 2 medications", detail: "Lisinopril (08:00, 21:00); Metformin (12:00)", step: "quantities" },
    ]);
  });

  it("explains what the organizer leaves out and why, without asking for anything", () => {
    const items = setupChecklist(
      plan({ ready: true, notGuided: [{ medicationId: "m1", reason: "as_needed" }, { medicationId: "m2", reason: "as_needed" }, { medicationId: "zz", reason: "paused" }] }),
      meds,
    );
    expect(items[0]).toEqual({ key: "not-guided", status: "info", title: "Left out of the organizer", detail: "Lisinopril, Metformin: taken as needed; A medication: paused" });
    expect(items.some((i) => i.status === "todo")).toBe(false);
  });

  it("notes doses in two groups as information", () => {
    const items = setupChecklist(plan({ ready: true, problems: [{ kind: "double_claim", severity: "warning", medicationId: "m1", time: "08:00" }] }), meds);
    expect(items[0]).toMatchObject({ key: "double-claim", status: "info", title: "1 dose is in two groups at once" });
  });

  it("says when there is nothing to fill yet", () => {
    const items = setupChecklist(plan({ doseTimes: [], ready: false }), meds);
    expect(items).toEqual([{ key: "no-doses", status: "todo", title: "No medications with fixed times yet", detail: "Add scheduled medications to fill an organizer with." }]);
  });

  it("lists problems in a stable order: times, then pills, then information, then ready", () => {
    const items = setupChecklist(
      plan({
        problems: [
          { kind: "missing_quantity", severity: "error", medicationId: "m1", time: "08:00" },
          { kind: "unmapped_time", severity: "error", time: "13:00", medicationIds: ["m1"] },
        ],
        notGuided: [{ medicationId: "m2", reason: "as_needed" }],
      }),
      meds,
    );
    expect(items.map((i) => i.key)).toEqual(["times", "quantities", "not-guided"]);
  });
});

describe("notGuidedReasonLabel and organizerErrorMessage", () => {
  it("labels every reason", () => {
    expect(notGuidedReasonLabel("as_needed")).toBe("taken as needed");
    expect(notGuidedReasonLabel("paused")).toBe("paused");
    expect(notGuidedReasonLabel("no_times")).toBe("has no fixed times");
  });

  it("turns a known code into a sentence and an unknown one into the fallback", () => {
    const err = (code: string) => new ApiError("API 400", 400, JSON.stringify({ error: code }));
    expect(organizerErrorMessage(err("duplicate_compartment_name"), "x")).toMatch(/same name/);
    expect(organizerErrorMessage(err("too_many_compartments"), "x")).toMatch(/8/);
    expect(organizerErrorMessage(err("caregiver_no_access"), "x")).toMatch(/see this person/);
    expect(organizerErrorMessage(err("something_new"), "Could not save.")).toBe("Could not save.");
    expect(organizerErrorMessage(new Error("boom"), "Could not save.")).toBe("Could not save.");
  });
});
