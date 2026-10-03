import { describe, expect, it } from "vitest";
import {
  buildCheckLogContext,
  checkLogSheet,
  checkRowValues,
  checkSlotBadge,
  checkSlotRowsForMember,
  findDeepLinkedRow,
  groupHighlightKeys,
  isCheckSlotPending,
  parseSlotInstant,
  slotLookupRange,
  summarizeCheckRows,
} from "./health-check-helpers";
import type { CheckSlot, CheckSlotStatus, HealthCheck, HealthEvent } from "./health-types";

const check = (over: Partial<HealthCheck> = {}): HealthCheck => ({
  id: "c1",
  memberId: "ally",
  groupIds: [],
  name: "Ally BP",
  eventType: "vitals",
  template: {},
  scheduleKind: "scheduled",
  enabled: true,
  canLog: true,
  ...over,
});
const slot = (at: string, status: CheckSlotStatus = "upcoming", over: Partial<CheckSlot> = {}): CheckSlot => ({
  scheduledAt: `2026-10-02T${at}:00.000Z`,
  status,
  source: null,
  logId: null,
  eventId: null,
  ...over,
});

describe("isCheckSlotPending", () => {
  it("is true until the slot has an answer", () => {
    expect((["upcoming", "due", "overdue"] as const).map(isCheckSlotPending)).toEqual([true, true, true]);
    expect((["done", "skipped", "missed"] as const).map(isCheckSlotPending)).toEqual([false, false, false]);
  });
});

describe("checkLogSheet", () => {
  it("picks the quick sheet for the four common types and the full editor for the rest", () => {
    const sheetFor = (eventType: HealthCheck["eventType"]) => checkLogSheet({ eventType });
    expect(sheetFor("vitals")).toBe("vitals");
    expect(sheetFor("pain")).toBe("pain");
    expect(sheetFor("food_intake")).toBe("meal");
    expect(sheetFor("exercise")).toBe("exercise");
    expect(sheetFor("symptom")).toBe("event");
    expect(sheetFor("other")).toBe("event");
  });
});

describe("buildCheckLogContext", () => {
  it("carries the template into the sheet and heads it with the check and time", () => {
    expect(
      buildCheckLogContext(
        check({ template: { metrics: ["blood_pressure_systolic", "blood_pressure_diastolic"], title: "Morning BP" } }),
        "12:05 PM",
      ),
    ).toEqual({
      heading: "Ally BP · 12:05 PM",
      metrics: ["blood_pressure_systolic", "blood_pressure_diastolic"],
      regions: undefined,
      activity: undefined,
      title: "Morning BP",
    });
  });

  it("treats an empty template as no prefill, so the sheet keeps its own defaults", () => {
    const ctx = buildCheckLogContext(check({ template: { metrics: [], regions: [], activity: "" } }), "8:00 AM");
    expect(ctx).toMatchObject({ metrics: undefined, regions: undefined, activity: undefined, title: undefined });
  });
});

describe("checkSlotRowsForMember", () => {
  const bp = check({ id: "bp", name: "BP" });
  const weight = check({ id: "wt", name: "Weight" });
  const other = check({ id: "ot", name: "Other", memberId: "dad" });
  const paused = check({ id: "ps", name: "Paused", enabled: false });
  const slots = new Map<string, CheckSlot[]>([
    ["bp", [slot("16:00"), slot("12:00", "overdue")]],
    ["wt", [slot("12:00", "done")]],
    ["ot", [slot("12:00")]],
    ["ps", [slot("12:00")]],
  ]);

  it("lists one person's slots in clock order, with the same time ordered by how much it needs doing", () => {
    const rows = checkSlotRowsForMember([bp, weight, other, paused], slots, "ally");
    expect(rows.map((r) => `${r.slot.scheduledAt.slice(11, 16)} ${r.check.name} ${r.slot.status}`)).toEqual([
      "12:00 BP overdue",
      "12:00 Weight done",
      "16:00 BP upcoming",
    ]);
  });

  it("is empty for someone with no checks", () => {
    expect(checkSlotRowsForMember([bp], slots, "nobody")).toEqual([]);
  });
});

describe("summarizeCheckRows", () => {
  it("counts done, total and overdue", () => {
    const rows = [
      { check: check(), slot: slot("08:00", "done") },
      { check: check(), slot: slot("12:00", "overdue") },
      { check: check(), slot: slot("16:00", "upcoming") },
      { check: check(), slot: slot("20:00", "skipped") },
    ];
    expect(summarizeCheckRows(rows)).toEqual({ done: 1, total: 4, overdue: 1 });
  });
});

describe("checkSlotBadge", () => {
  it("warns on overdue, due and missed, and is calm about the rest", () => {
    expect(checkSlotBadge("done")).toEqual({ label: "Done", tone: "success" });
    expect(checkSlotBadge("overdue").tone).toBe("warning");
    expect(checkSlotBadge("due").tone).toBe("warning");
    expect(checkSlotBadge("missed").tone).toBe("warning");
    expect(checkSlotBadge("upcoming").tone).toBe("default");
    expect(checkSlotBadge("skipped").tone).toBe("default");
  });
});

describe("deep links from a notification", () => {
  const bp = check({ id: "bp" });
  const rows = [
    { check: bp, slot: slot("12:00", "done") },
    { check: bp, slot: slot("16:00", "upcoming") },
    { check: check({ id: "wt" }), slot: slot("16:00", "upcoming") },
  ];

  it("reads the slot instant to the minute and rejects junk", () => {
    expect(parseSlotInstant("2026-10-02T17:05:30.000Z")).toBe(Date.parse("2026-10-02T17:05:00.000Z"));
    expect(parseSlotInstant("nope")).toBeNull();
    expect(parseSlotInstant(undefined)).toBeNull();
  });

  it("finds the row for the check and time in the link", () => {
    expect(findDeepLinkedRow(rows, "bp", "2026-10-02T16:00:00.000Z")?.slot.scheduledAt).toBe("2026-10-02T16:00:00.000Z");
    // A different second of the same minute still finds it.
    expect(findDeepLinkedRow(rows, "bp", "2026-10-02T16:00:20.000Z")).toBeDefined();
  });

  it("finds an answered slot too, so the page can say it is already done", () => {
    expect(findDeepLinkedRow(rows, "bp", "2026-10-02T12:00:00.000Z")?.slot.status).toBe("done");
  });

  it("returns nothing for a slot that is not there, and never another check's slot", () => {
    expect(findDeepLinkedRow(rows, "bp", "2026-10-02T09:00:00.000Z")).toBeUndefined();
    expect(findDeepLinkedRow(rows, "gone", "2026-10-02T16:00:00.000Z")).toBeUndefined();
  });

  it("with no time in the link, opens the next thing waiting on that check", () => {
    expect(findDeepLinkedRow(rows, "bp", undefined)?.slot.scheduledAt).toBe("2026-10-02T16:00:00.000Z");
  });
});

describe("checkRowValues", () => {
  const event = (over: Partial<HealthEvent>): HealthEvent => ({
    id: "e",
    memberId: "ally",
    medicationId: null,
    type: "vitals",
    title: "Vitals",
    notes: null,
    startedAt: null,
    endedAt: null,
    visibility: "private",
    ...over,
  });

  it("shows the values of the entry that completed the slot", () => {
    expect(
      checkRowValues(
        event({
          readings: [
            { metric: "blood_pressure_systolic", value: 128, unit: "mmHg" },
            { metric: "blood_pressure_diastolic", value: 82, unit: "mmHg" },
          ],
        }),
      ),
    ).toBe("BP 128/82");
  });

  it("is empty when the viewer cannot open the entry", () => {
    expect(checkRowValues(undefined)).toBeNull();
  });

  it("falls back to the title for types without structured values", () => {
    expect(checkRowValues(event({ type: "symptom", title: "Headache" }))).toBe("Headache");
  });
});

describe("slotLookupRange", () => {
  it("spans a day either side of the slot, so any time zone's day for it is covered", () => {
    expect(slotLookupRange("2026-10-02T17:05:00.000Z")).toEqual({ from: "2026-10-01", to: "2026-10-03" });
    // Just after midnight UTC, where the local day can be the one before.
    expect(slotLookupRange("2026-10-03T00:05:00.000Z")).toEqual({ from: "2026-10-02", to: "2026-10-04" });
  });

  it("uses today when the link has no (or a bad) time", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    expect(slotLookupRange(undefined, now)).toEqual({ from: "2026-10-01", to: "2026-10-03" });
    expect(slotLookupRange("junk", now)).toEqual({ from: "2026-10-01", to: "2026-10-03" });
  });
});

describe("groupHighlightKeys", () => {
  it("marks each member check at the minute a group notification is for", () => {
    const keys = groupHighlightKeys(["a", "b"], "2026-10-02T17:05:40.000Z");
    const minute = Date.parse("2026-10-02T17:05:00.000Z") / 60_000;
    expect([...keys].sort()).toEqual([`a|${minute}`, `b|${minute}`]);
  });

  it("marks nothing without a usable time", () => {
    expect(groupHighlightKeys(["a"], undefined).size).toBe(0);
    expect(groupHighlightKeys(["a"], "nope").size).toBe(0);
  });
});
