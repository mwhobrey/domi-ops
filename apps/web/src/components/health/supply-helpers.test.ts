import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/client-api";
import type { HealthMedication } from "./health-types";
import {
  canMarkRequested,
  daysLeftLabel,
  formatDay,
  groupBySupply,
  medsNeedingConfirmation,
  medsNeedingSetup,
  parseDays,
  parseFillSuggestion,
  parseOutsidePills,
  parsePreview,
  parseQuarters,
  pillsLastLabel,
  planSetupRow,
  previewLabel,
  requestAgeLabel,
  setupDismissKey,
  supplyChip,
  supplyErrorMessage,
  supplyStatus,
} from "./supply-helpers";
import type { RefillState, SupplySummary } from "./supply-types";

const supply = (over: Partial<SupplySummary> = {}): SupplySummary => ({
  runsOutOn: "2026-10-20",
  estimatedOn: "2026-10-01",
  daysRemaining: 14,
  outsideDays: 14,
  outsidePills: null,
  organizerDaysCounted: 0,
  revision: 1,
  version: 1,
  leadDays: 7,
  leadDaysOverride: null,
  state: "ok",
  deadline: "2026-10-13",
  overdue: false,
  requestedAt: null,
  receivedAt: null,
  needsConfirmation: false,
  ...over,
});

const med = (name: string, over: Partial<HealthMedication> = {}): HealthMedication => ({
  id: name,
  memberId: "m1",
  name,
  dosage: null,
  instructions: null,
  scheduleKind: "prn",
  schedule: {},
  reminderOffsets: [0],
  startDate: null,
  endDate: null,
  enabled: true,
  visibility: "household",
  ...over,
});

describe("formatDay", () => {
  it("formats a calendar day from its parts, whatever the browser's time zone", () => {
    expect(formatDay("2026-10-14")).toBe("Oct 14");
    expect(formatDay("2026-01-01")).toBe("Jan 1");
    expect(formatDay("2026-12-31")).toBe("Dec 31");
  });

  it("returns an empty string for nothing and the input for what it cannot read", () => {
    expect(formatDay(null)).toBe("");
    expect(formatDay(undefined)).toBe("");
    expect(formatDay("")).toBe("");
    expect(formatDay("soon")).toBe("soon");
    expect(formatDay("2026-13-01")).toBe("2026-13-01");
  });
});

describe("daysLeftLabel", () => {
  it("counts days, singular and plural, and says when there are none", () => {
    expect(daysLeftLabel(9)).toBe("9 days left");
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(0)).toBe("Out of supply");
    expect(daysLeftLabel(-3)).toBe("Out of supply");
    expect(daysLeftLabel(null)).toBe("");
  });
});

describe("requestAgeLabel", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("says how long ago, never negative", () => {
    expect(requestAgeLabel("2026-10-10T08:00:00Z", now)).toBe("Requested today");
    expect(requestAgeLabel("2026-10-09T08:00:00Z", now)).toBe("Requested yesterday");
    expect(requestAgeLabel("2026-10-07T12:00:00Z", now)).toBe("Requested 3 days ago");
    expect(requestAgeLabel("2026-10-12T12:00:00Z", now)).toBe("Requested today");
  });

  it("has nothing to say without a usable time", () => {
    expect(requestAgeLabel(null, now)).toBe("");
    expect(requestAgeLabel("garbage", now)).toBe("");
  });
});

describe("supplyStatus", () => {
  const cases: Array<[RefillState, boolean, string, string]> = [
    ["ok", false, "OK", "success"],
    ["not_needed", false, "Covered", "success"],
    ["needs_refill", false, "Needs refill", "warning"],
    ["needs_refill", true, "Overdue", "danger"],
    ["requested", false, "Requested", "accent"],
    ["requested", true, "Requested · overdue", "danger"],
    ["no_estimate", false, "No estimate", "default"],
    ["inactive", false, "Paused", "default"],
  ];
  it.each(cases)("%s (overdue: %s) reads %s", (state, overdue, label, tone) => {
    expect(supplyStatus(supply({ state, overdue }), true)).toEqual({ label, tone });
  });

  it("shows a paused medication as paused whatever its dates say", () => {
    expect(supplyStatus(supply({ state: "needs_refill", overdue: true }), false)).toEqual({ label: "Paused", tone: "default" });
  });
});

describe("supplyChip", () => {
  it("adds the days left where they help", () => {
    expect(supplyChip(supply({ daysRemaining: 14 }), true)?.label).toBe("OK · 14d");
    expect(supplyChip(supply({ state: "needs_refill", daysRemaining: 3 }), true)?.label).toBe("Needs refill · 3d");
    expect(supplyChip(supply({ state: "requested", daysRemaining: 3 }), true)?.label).toBe("Requested");
    expect(supplyChip(supply({ daysRemaining: 14 }), false)?.label).toBe("Paused");
  });

  it("shows nothing for a medication with no estimate yet", () => {
    expect(supplyChip(supply({ runsOutOn: null, state: "no_estimate", daysRemaining: null }), true)).toBeNull();
  });

  it("still shows a request that was made before any estimate", () => {
    expect(supplyChip(supply({ runsOutOn: null, state: "requested", daysRemaining: null }), true)?.label).toBe("Requested");
  });
});

describe("canMarkRequested", () => {
  it("is for active medications with nothing open", () => {
    expect(canMarkRequested(supply(), true)).toBe(true);
    expect(canMarkRequested(undefined, true)).toBe(true);
    expect(canMarkRequested(supply({ state: "requested" }), true)).toBe(false);
    expect(canMarkRequested(supply(), false)).toBe(false);
  });
});

describe("groupBySupply", () => {
  const a = { id: "pa", name: "Alpha Pharmacy", archived: false };
  const b = { id: "pb", name: "Beta Pharmacy", archived: false };

  it("groups by pharmacy, the most urgent first, and the no-pharmacy group last", () => {
    const meds = [
      med("calm", { pharmacy: a, supply: supply({ state: "ok", deadline: "2026-10-30", runsOutOn: "2026-11-06" }) }),
      med("urgent", { pharmacy: a, supply: supply({ state: "needs_refill", deadline: "2026-10-05" }) }),
      med("asked", { pharmacy: b, supply: supply({ state: "requested", deadline: "2026-10-02" }) }),
      med("loose", { supply: supply({ state: "needs_refill", deadline: "2026-09-01" }) }),
      med("unknown", { pharmacy: a }),
      med("paused", { pharmacy: a, enabled: false, supply: supply({ state: "inactive" }) }),
    ];
    const groups = groupBySupply(meds);
    expect(groups.map((g) => g.pharmacy?.name ?? "none")).toEqual(["Beta Pharmacy", "Alpha Pharmacy", "none"]);
    expect(groups[1]!.items.map((i) => i.medication.name)).toEqual(["urgent", "calm", "unknown", "paused"]);
  });

  it("keeps medications without any supply information, with a null supply", () => {
    const [group] = groupBySupply([med("plain")]);
    expect(group!.key).toBe("none");
    expect(group!.items).toEqual([{ medication: expect.objectContaining({ name: "plain" }), supply: null }]);
  });

  it("does not change its input and handles nothing", () => {
    const meds = [med("b"), med("a")];
    groupBySupply(meds);
    expect(meds.map((m) => m.name)).toEqual(["b", "a"]);
    expect(groupBySupply([])).toEqual([]);
  });
});

describe("parsePreview and previewLabel", () => {
  it("reads a dry-run estimate", () => {
    const p = parsePreview({ dryRun: true, needsConfirmation: false, runsOutOn: "2026-11-20", totalDays: 35, organizerDays: 31, outsideDays: 4 });
    expect(p).toEqual({ kind: "ok", runsOutOn: "2026-11-20", totalDays: 35, organizerDays: 31, outsideDays: 4 });
    expect(previewLabel(p as Extract<typeof p, { kind: "ok" }>)).toBe("Runs out Nov 20 · 35 days (31 in organizers + 4 outside)");
  });

  it("leaves out the organizer split when the organizers hold nothing, and says 1 day", () => {
    const p = parsePreview({ dryRun: true, runsOutOn: "2026-10-11", totalDays: 1, organizerDays: 0, outsideDays: 1 });
    expect(previewLabel(p as Extract<typeof p, { kind: "ok" }>)).toBe("Runs out Oct 11 · 1 day");
  });

  it("reads a gap that needs the total in hand", () => {
    expect(parsePreview({ dryRun: true, needsConfirmation: true, organizerDays: 5, organizerEndsOn: "2026-10-14" })).toEqual({
      kind: "gap",
      organizerDays: 5,
      organizerEndsOn: "2026-10-14",
    });
  });

  it("is null for anything that is not a dry run", () => {
    for (const bad of [null, undefined, 5, "x", {}, { runsOutOn: "2026-10-20", totalDays: 3 }, { dryRun: true }, { dryRun: true, runsOutOn: 5, totalDays: 3 }]) {
      expect(parsePreview(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("parseDays", () => {
  it("accepts whole numbers up to the limit", () => {
    expect(parseDays("0", 3650)).toBe(0);
    expect(parseDays(" 42 ", 3650)).toBe(42);
    expect(parseDays("3650", 3650)).toBe(3650);
  });

  it("refuses everything else", () => {
    for (const bad of ["", " ", "-1", "1.5", "1e3", "abc", "3651", "0x10", "٣"]) expect(parseDays(bad, 3650), bad).toBeNull();
  });
});

describe("supplyErrorMessage", () => {
  const err = (code: string) => new ApiError("API 409", 409, JSON.stringify({ error: code }));
  it("explains known codes and falls back for the rest", () => {
    expect(supplyErrorMessage(err("version_conflict"), "x")).toMatch(/Someone else/);
    expect(supplyErrorMessage(err("medication_inactive"), "x")).toMatch(/paused/);
    expect(supplyErrorMessage(err("supply_too_large"), "x")).toMatch(/ten years/);
    expect(supplyErrorMessage(err("brand_new"), "Could not save.")).toBe("Could not save.");
    expect(supplyErrorMessage(new Error("boom"), "Could not save.")).toBe("Could not save.");
  });
});

describe("medsNeedingSetup and medsNeedingConfirmation", () => {
  it("lists active medications with no estimate, by name, leaving paused and estimated ones out", () => {
    const meds = [
      med("zinc"),
      med("amoxicillin", { supply: supply({ runsOutOn: null, state: "no_estimate", daysRemaining: null }) }),
      med("done", { supply: supply() }),
      med("paused", { enabled: false }),
      med("pharmacy only", { pharmacy: { id: "p", name: "P", archived: false }, supply: supply({ runsOutOn: null, state: "no_estimate" }) }),
    ];
    expect(medsNeedingSetup(meds).map((m) => m.name)).toEqual(["amoxicillin", "pharmacy only", "zinc"]);
    expect(meds.map((m) => m.name)).toEqual(["zinc", "amoxicillin", "done", "paused", "pharmacy only"]);
  });

  it("lists active medications whose estimate needs confirming", () => {
    const meds = [
      med("a", { supply: supply({ needsConfirmation: true }) }),
      med("b", { supply: supply() }),
      med("c", { enabled: false, supply: supply({ needsConfirmation: true }) }),
      med("d"),
    ];
    expect(medsNeedingConfirmation(meds).map((m) => m.name)).toEqual(["a"]);
  });
});

describe("parseOutsidePills", () => {
  it.each([
    ["30", 30],
    ["0", 0],
    ["12.5", 12.5],
    ["12½", 12.5],
    ["1 3/4", 1.75],
    [" ¼ ", 0.25],
  ])("reads %s", (text, pills) => {
    expect(parseOutsidePills(text)).toBe(pills);
  });

  it.each(["", "  ", "a lot", "1.3", "1/3", "-2", "100001"])("refuses %j", (text) => {
    expect(parseOutsidePills(text)).toBeNull();
  });

  it("gives a reason a dose field can use", () => {
    expect(parseQuarters("")).toEqual({ ok: false, reason: "empty" });
    expect(parseQuarters("1.3")).toEqual({ ok: false, reason: "not_quarter" });
    expect(parseQuarters("x")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("pillsLastLabel", () => {
  it("reads for one and for many", () => {
    expect(pillsLastLabel("1", 1, 1)).toBe("1 pill lasts 1 day.");
    expect(pillsLastLabel("12½", 12.5, 12)).toBe("12½ pills last 12 days.");
  });
});

describe("parseFillSuggestion", () => {
  it("reads what a fill would use and leave", () => {
    expect(parseFillSuggestion({ dryRun: true, pillsUsed: 7, lastCountPills: 60, suggestedOutsidePills: 53 })).toEqual({ pillsUsed: 7, lastCountPills: 60, suggestedOutsidePills: 53 });
  });

  it("reads a fill with no count to start from", () => {
    expect(parseFillSuggestion({ dryRun: true, pillsUsed: 7, lastCountPills: null, suggestedOutsidePills: null })).toEqual({ pillsUsed: 7, lastCountPills: null, suggestedOutsidePills: null });
  });

  it("is not fooled by an ordinary preview", () => {
    expect(parseFillSuggestion({ dryRun: true, needsConfirmation: false, runsOutOn: "2026-11-20", totalDays: 3 })).toBeNull();
    expect(parseFillSuggestion(null)).toBeNull();
  });
});

describe("planSetupRow", () => {
  it("sends pills for a medication counted in pills", () => {
    expect(planSetupRow({ countsPills: true, amountText: "12½", pharmacyId: "", originalPharmacyId: "" })).toEqual({ kind: "save", body: { outsidePills: 12.5 } });
    expect(planSetupRow({ countsPills: true, amountText: "1.3", pharmacyId: "", originalPharmacyId: "" })).toEqual({ kind: "invalid" });
    expect(planSetupRow({ countsPills: true, amountText: "", pharmacyId: "", originalPharmacyId: "" })).toEqual({ kind: "skip" });
  });

  it("leaves an untouched row alone", () => {
    expect(planSetupRow({ countsPills: false, amountText: "", pharmacyId: "", originalPharmacyId: "" })).toEqual({ kind: "skip" });
    expect(planSetupRow({ countsPills: false, amountText: "  ", pharmacyId: "p1", originalPharmacyId: "p1" })).toEqual({ kind: "skip" });
  });

  it("saves the days, and the pharmacy only when it changed", () => {
    expect(planSetupRow({ countsPills: false, amountText: "30", pharmacyId: "", originalPharmacyId: "" })).toEqual({ kind: "save", body: { outsideDays: 30 } });
    expect(planSetupRow({ countsPills: false, amountText: "30", pharmacyId: "p2", originalPharmacyId: "p1" })).toEqual({ kind: "save", body: { outsideDays: 30, pharmacyId: "p2" } });
    expect(planSetupRow({ countsPills: false, amountText: "0", pharmacyId: "p1", originalPharmacyId: "p1" })).toEqual({ kind: "save", body: { outsideDays: 0 } });
  });

  it("saves a pharmacy on its own, and clearing one sends null", () => {
    expect(planSetupRow({ countsPills: false, amountText: "", pharmacyId: "p1", originalPharmacyId: "" })).toEqual({ kind: "save", body: { pharmacyId: "p1" } });
    expect(planSetupRow({ countsPills: false, amountText: "", pharmacyId: "", originalPharmacyId: "p1" })).toEqual({ kind: "save", body: { pharmacyId: null } });
  });

  it("flags days that are not a whole number in range", () => {
    for (const bad of ["abc", "-1", "1.5", "3651", "1e2"]) {
      expect(planSetupRow({ countsPills: false, amountText: bad, pharmacyId: "", originalPharmacyId: "" }), bad).toEqual({ kind: "invalid" });
    }
  });
});

describe("setupDismissKey", () => {
  it("is separate for each person", () => {
    expect(setupDismissKey("m1")).not.toBe(setupDismissKey("m2"));
    expect(setupDismissKey("m1")).toContain("m1");
  });
});
