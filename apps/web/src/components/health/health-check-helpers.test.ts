import { describe, expect, it } from "vitest";
import {
  buildCheckLogContext,
  checkLogSheet,
  checkRowValues,
  checkSlotBadge,
  checkSlotRowsForMember,
  findDeepLinkedRow,
  groupCoversSlot,
  groupHighlightKeys,
  isCheckSlotPending,
  parseSlotInstant,
  pendingRows,
  slotCountsByEvent,
  slotEditableEvent,
  slotLookupRange,
  splitCheckRowsByGroup,
  summarizeCheckRows,
} from "./health-check-helpers";
import type { CheckSlot, CheckSlotStatus, HealthCheck, HealthCheckGroup, HealthEvent } from "./health-types";

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

describe("slotCountsByEvent", () => {
  const fmt = (iso: string) => iso.slice(11, 16);

  it("names the check and time each entry answers", () => {
    const checks = [check({ id: "c1", name: "Ally BP" }), check({ id: "c2", name: "Weight" })];
    const slots = new Map([
      ["c1", [slot("12:00", "done", { eventId: "e1" }), slot("16:00", "upcoming")]],
      ["c2", [slot("12:00", "done", { eventId: "e1" }), slot("20:00", "skipped")]],
    ]);
    expect(slotCountsByEvent(checks, slots, fmt)).toEqual(new Map([["e1", ["Ally BP · 12:00", "Weight · 12:00"]]]));
  });

  it("ignores slots with no entry, and checks it does not know", () => {
    const slots = new Map([["gone", [slot("12:00", "done", { eventId: "e9" })]]]);
    expect(slotCountsByEvent([check()], slots, fmt).size).toBe(0);
  });
});

describe("slotEditableEvent", () => {
  const ev = (over: Partial<HealthEvent> = {}) => ({ id: "e1", type: "vitals", title: "BP", ...over }) as HealthEvent;
  const row = (s: CheckSlot) => ({ check: check(), slot: s });

  it("is the entry that answered a done slot, when the viewer may edit it", () => {
    const e = ev();
    expect(slotEditableEvent(row(slot("12:00", "done", { eventId: "e1" })), [ev({ id: "other" }), e])).toBe(e);
    expect(slotEditableEvent(row(slot("12:00", "done", { eventId: "e1" })), [ev({ canEdit: true })])?.id).toBe("e1");
  });

  it("is nothing when the entry is read-only, missing from the list, or the slot has none", () => {
    expect(slotEditableEvent(row(slot("12:00", "done", { eventId: "e1" })), [ev({ canEdit: false })])).toBeUndefined();
    expect(slotEditableEvent(row(slot("12:00", "done", { eventId: "e1" })), [])).toBeUndefined();
    expect(slotEditableEvent(row(slot("12:00", "skipped")), [ev()])).toBeUndefined();
  });

  it("is nothing while the slot is still waiting", () => {
    expect(slotEditableEvent(row(slot("12:00", "due", { eventId: "e1" })), [ev()])).toBeUndefined();
  });
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

describe("check groups on the Today tab", () => {
  // Built from local time, the zone the helpers read slots in, so these hold in any zone.
  const at = (hours: number, minutes = 0) => new Date(2026, 9, 5, hours, minutes).toISOString(); // Mon 5 Oct 2026
  const localSlot = (h: number, status: CheckSlotStatus = "upcoming", over: Partial<CheckSlot> = {}): CheckSlot => ({
    scheduledAt: at(h),
    status,
    source: null,
    logId: null,
    eventId: null,
    ...over,
  });
  const bp = check({ id: "bp", name: "BP" });
  const weight = check({ id: "wt", name: "Weight" });
  const pain = check({ id: "pn", name: "Pain" });
  const group = (over: Partial<HealthCheckGroup> = {}): HealthCheckGroup => ({
    id: "g1",
    memberId: "ally",
    name: "Morning",
    scheduleKind: "scheduled",
    schedule: { times: ["08:00"] },
    enabled: true,
    checks: [bp, weight],
    ...over,
  });

  describe("groupCoversSlot", () => {
    it("covers a member's slot at one of the group's times", () => {
      expect(groupCoversSlot(group(), bp, at(8))).toBe(true);
      expect(groupCoversSlot(group(), bp, at(8, 1))).toBe(false);
      expect(groupCoversSlot(group({ schedule: { times: ["08:00:30"] } }), bp, at(8))).toBe(true);
    });

    it("needs the check to be in the group, scheduled, and the group to be on and scheduled", () => {
      expect(groupCoversSlot(group(), pain, at(8))).toBe(false);
      expect(groupCoversSlot(group(), { ...bp, scheduleKind: "interval" }, at(8))).toBe(false);
      expect(groupCoversSlot(group({ enabled: false }), bp, at(8))).toBe(false);
      expect(groupCoversSlot(group({ scheduleKind: "interval" }), bp, at(8))).toBe(false);
    });

    it("respects the group's days and dates, so an off day isn't swallowed", () => {
      expect(groupCoversSlot(group({ schedule: { times: ["08:00"], daysOfWeek: [1] } }), bp, at(8))).toBe(true); // Monday
      expect(groupCoversSlot(group({ schedule: { times: ["08:00"], daysOfWeek: [2, 3] } }), bp, at(8))).toBe(false);
      expect(groupCoversSlot(group({ startDate: "2026-10-06" }), bp, at(8))).toBe(false);
      expect(groupCoversSlot(group({ endDate: "2026-10-04" }), bp, at(8))).toBe(false);
      expect(groupCoversSlot(group({ startDate: "2026-10-05", endDate: "2026-10-05" }), bp, at(8))).toBe(true);
    });
  });

  describe("splitCheckRowsByGroup", () => {
    it("shows the members at the group's time under the group and leaves other times loose", () => {
      const rows = [
        { check: bp, slot: localSlot(8, "done") },
        { check: weight, slot: localSlot(8) },
        { check: bp, slot: localSlot(12) },
        { check: pain, slot: localSlot(8) },
      ];
      const { cards, loose } = splitCheckRowsByGroup(rows, [group()]);
      expect(cards).toHaveLength(1);
      expect(cards[0]!.group.name).toBe("Morning");
      expect(cards[0]!.rows.map((r) => r.check.name)).toEqual(["BP", "Weight"]);
      expect(loose.map((r) => `${r.check.name} ${new Date(r.slot.scheduledAt).getHours()}`)).toEqual(["BP 12", "Pain 8"]);
    });

    it("keeps answered members in the card, so a partly done group still shows what is left", () => {
      const rows = [
        { check: bp, slot: localSlot(8, "done") },
        { check: weight, slot: localSlot(8, "upcoming") },
      ];
      const { cards } = splitCheckRowsByGroup(rows, [group()]);
      expect(pendingRows(cards[0]!.rows).map((r) => r.check.name)).toEqual(["Weight"]);
    });

    it("gives each group time its own card, in clock order", () => {
      const evening = group({ id: "g2", name: "Evening", schedule: { times: ["20:00"] } });
      const rows = [
        { check: bp, slot: localSlot(20) },
        { check: bp, slot: localSlot(8) },
      ];
      const { cards } = splitCheckRowsByGroup(rows, [evening, group()]);
      expect(cards.map((c) => c.group.name)).toEqual(["Morning", "Evening"]);
    });

    it("puts a slot in one group only, even if two cover it", () => {
      const other = group({ id: "g0", name: "Other" });
      const { cards } = splitCheckRowsByGroup([{ check: bp, slot: localSlot(8) }], [group(), other]);
      expect(cards).toHaveLength(1);
      expect(cards[0]!.group.id).toBe("g0"); // lowest id wins, so the choice doesn't depend on load order
    });

    it("leaves everything loose without groups", () => {
      const rows = [{ check: bp, slot: localSlot(8) }];
      expect(splitCheckRowsByGroup(rows, [])).toEqual({ cards: [], loose: rows });
    });
  });
});
