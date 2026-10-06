import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/client-api";
import type { HealthMedication } from "./health-types";
import {
  canMarkRequested,
  daysLeftLabel,
  formatDay,
  groupBySupply,
  parseDays,
  parsePreview,
  previewLabel,
  requestAgeLabel,
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
