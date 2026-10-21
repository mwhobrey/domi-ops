import { describe, expect, it } from "vitest";
import {
  CHECK_ATTACH_SUGGEST_RADIUS_MS,
  CHECK_SLOT_TOLERANCE_MS,
  computeSlotStatuses,
  eventQualifiesForCheck,
  excludeInactiveInstants,
  intervalCheckSlots,
  matchEventsToSlots,
  scheduledCheckSlots,
  suggestAttachments,
  type CheckForSlots,
  type CheckSlotEvent,
  type CheckSlotLog,
} from "./health-check-slots.js";
import { parseIntervalSchedule } from "./med-interval-schedule.js";

const MIN = 60_000;
const at = (iso: string) => new Date(iso);

const bp: CheckForSlots = {
  eventType: "vitals",
  memberId: "ally",
  requiredMetrics: ["blood_pressure_systolic", "blood_pressure_diastolic"],
};

const reading = (id: string, iso: string | null, over: Partial<CheckSlotEvent> = {}): CheckSlotEvent => ({
  id,
  memberId: "ally",
  type: "vitals",
  startedAt: iso ? at(iso) : null,
  metrics: ["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"],
  ...over,
});

// Four-times-a-day BP, in UTC so the instants are easy to read.
const day = ["2026-10-02T08:00:00.000Z", "2026-10-02T12:00:00.000Z", "2026-10-02T16:00:00.000Z", "2026-10-02T20:00:00.000Z"].map(at);
const NOON = day[1]!;

const statuses = (over: {
  slots?: Date[];
  logs?: CheckSlotLog[];
  events?: CheckSlotEvent[];
  now?: Date;
  check?: CheckForSlots;
}) =>
  computeSlotStatuses({
    check: over.check ?? bp,
    slots: over.slots ?? day,
    logs: over.logs ?? [],
    events: over.events ?? [],
    now: over.now ?? at("2026-10-03T00:00:00.000Z"),
  }).map((r) => r.status);

describe("an unlinked entry completes the slot it is near", () => {
  it("counts a reading taken 10 minutes late (the 12:10 BP completes the 12:00 check)", () => {
    const r = computeSlotStatuses({
      check: bp,
      slots: day,
      logs: [],
      events: [reading("e1", "2026-10-02T12:10:00.000Z")],
      now: at("2026-10-02T13:00:00.000Z"),
    });
    expect(r[1]).toMatchObject({ status: "done", source: "event", eventId: "e1", logId: null });
    expect(r[0]!.status).toBe("overdue");
    expect(r[2]!.status).toBe("upcoming");
  });

  it("counts a reading taken early", () => {
    expect(statuses({ events: [reading("e1", "2026-10-02T11:45:00.000Z")] })).toEqual(["overdue", "done", "overdue", "overdue"]);
  });

  it("includes the tolerance edge and excludes one minute beyond it", () => {
    const edge = CHECK_SLOT_TOLERANCE_MS / MIN;
    expect(edge).toBe(30);
    expect(statuses({ events: [reading("e1", "2026-10-02T12:30:00.000Z")] })[1]).toBe("done");
    expect(statuses({ events: [reading("e1", "2026-10-02T11:30:00.000Z")] })[1]).toBe("done");
    expect(statuses({ events: [reading("e1", "2026-10-02T12:31:00.000Z")] })[1]).toBe("overdue");
    expect(statuses({ events: [reading("e1", "2026-10-02T11:29:00.000Z")] })[1]).toBe("overdue");
  });

  it("ignores entries with no time, the wrong person, the wrong kind, or missing metrics", () => {
    const none = statuses({
      events: [
        reading("noTime", null),
        reading("someoneElse", "2026-10-02T12:00:00.000Z", { memberId: "mom" }),
        reading("pain", "2026-10-02T12:00:00.000Z", { type: "pain" }),
        // Weight only: has none of the BP metrics the check asks for.
        reading("weightOnly", "2026-10-02T12:00:00.000Z", { metrics: ["weight"] }),
        // Systolic without diastolic is half a blood pressure.
        reading("half", "2026-10-02T12:00:00.000Z", { metrics: ["blood_pressure_systolic"] }),
      ],
    });
    expect(none).toEqual(["overdue", "overdue", "overdue", "overdue"]);
  });

  it("accepts any vitals entry when the check names no metrics", () => {
    const anyVitals: CheckForSlots = { eventType: "vitals", memberId: "ally" };
    expect(statuses({ check: anyVitals, events: [reading("w", "2026-10-02T12:00:00.000Z", { metrics: ["weight"] })] })[1]).toBe("done");
  });
});

describe("Withings check sessions", () => {
  const combined = { ...bp, requiredMetrics: [...bp.requiredMetrics!, "heart_rate", "temperature", "blood_oxygen"] };
  const cuff = (id: string, time: string) => reading(id, `2026-10-02T${time}:00Z`, { withings: true });
  const scan = reading("scan", "2026-10-02T08:48:00Z", { withings: true, metrics: ["temperature", "blood_oxygen"] });
  const events = [cuff("bp1", "08:20"), cuff("bp2", "08:45"), cuff("bp3", "08:46"), scan];
  const compute = (over: Partial<Parameters<typeof computeSlotStatuses>[0]> = {}) => computeSlotStatuses({
    check: combined, slots: day, logs: [], events, now: at("2026-10-02T10:00:00Z"), ...over,
  });

  it("combines cuff and ScanWatch readings from the reported morning session", () => {
    const result = compute();
    expect(result[0]).toMatchObject({ status: "done", eventIds: ["bp1", "bp2", "bp3", "scan"] });
    expect(result[1]).toMatchObject({ status: "upcoming", eventId: null });
    expect(compute({ events: [...events].reverse() })).toEqual(result);
  });

  it("adds later imports to a slot already explicitly logged with temperature and SpO2", () => {
    expect(compute({ logs: [{ id: "log", scheduledAt: day[0]!, status: "done", healthEventId: "scan" }] })[0])
      .toMatchObject({ status: "done", source: "log", eventId: "scan", eventIds: ["bp1", "bp2", "bp3", "scan"] });
  });

  it("shows partial contributions and reopens inferred completion when a device reading is removed", () => {
    expect(compute({ events: [events[0]!] })[0]).toMatchObject({ status: "overdue", eventId: null, eventIds: ["bp1"] });
    expect(compute({ events: events.filter((e) => e.id !== "scan") })[0]!.status).toBe("overdue");
    expect(compute({ events: events.map((e) => e.id === "scan" ? { ...e, metrics: ["temperature"] } : e) })[0]!.status).toBe("overdue");
  });

  it("does not chain readings across the day or combine different people and entry types", () => {
    const late = { ...scan, startedAt: at("2026-10-02T09:12:00Z") };
    expect(compute({ events: [...events.filter((e) => e.id !== "scan"), late] })[0]!.status).toBe("overdue");
    for (const wrong of [{ ...scan, memberId: "other" }, { ...scan, type: "pain" }, { ...scan, withings: false }]) {
      expect(compute({ events: [events[0]!, wrong] })[0]!.status).toBe("overdue");
    }
  });

  it("preserves deliberate skips and entries reserved by another slot, including outside the range", () => {
    expect(compute({ logs: [{ id: "skip", scheduledAt: day[0]!, status: "skipped", healthEventId: null }] })[0])
      .toMatchObject({ status: "skipped", eventId: null });
    expect(compute({ logs: [{ id: "elsewhere", scheduledAt: at("2026-10-03T08:00:00Z"), status: "done", healthEventId: "scan" }] })[0]!.status)
      .toBe("overdue");
  });

  it("reserves each contributing entry for one adjacent slot", () => {
    const result = compute({ slots: [day[0]!, at("2026-10-02T08:50:00Z")] });
    const ids = result.flatMap((s) => s.eventIds ?? []);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result[0]!.status).toBe("overdue");
    expect(result[1]!.status).toBe("done");
  });

  it("does not spill repeated complete BP readings onto a farther adjacent slot", () => {
    const result = compute({ check: bp, slots: [day[0]!, at("2026-10-02T08:40:00Z")],
      events: [cuff("a", "08:05"), cuff("b", "08:10"), cuff("c", "08:15")],
    });
    expect(result[0]).toMatchObject({ status: "done", eventIds: ["a", "b", "c"] });
    expect(result[1]!.status).toBe("overdue");
  });

  it("keeps interval matching unchanged", () => {
    expect(compute({ combineWithings: false })[0]!.status).toBe("overdue");
  });
});

describe("one entry, one slot", () => {
  it("two entries near one slot: the closest completes it, the other does not", () => {
    const r = computeSlotStatuses({
      check: bp,
      slots: day,
      logs: [],
      events: [reading("far", "2026-10-02T12:20:00.000Z"), reading("near", "2026-10-02T12:04:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r[1]).toMatchObject({ status: "done", eventId: "near" });
  });

  it("one entry between two close slots completes only the closer one", () => {
    // Two slots 40 minutes apart; a reading 15 min after the first is within 30 of both... it is
    // 25 minutes before the second, so the first (closer) wins and the second stays open.
    const slots = [at("2026-10-02T12:00:00.000Z"), at("2026-10-02T12:40:00.000Z")];
    const r = computeSlotStatuses({
      check: bp,
      slots,
      logs: [],
      events: [reading("e1", "2026-10-02T12:15:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r.map((x) => x.status)).toEqual(["done", "overdue"]);
    expect(r[0]!.eventId).toBe("e1");
  });

  it("matches closest first: a reading nearer the later slot completes the later slot", () => {
    // 12:25 is 25 minutes after the first slot but only 15 before the second.
    const slots = [at("2026-10-02T12:00:00.000Z"), at("2026-10-02T12:40:00.000Z")];
    const r = computeSlotStatuses({
      check: bp,
      slots,
      logs: [],
      events: [reading("e1", "2026-10-02T12:25:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r.map((x) => x.status)).toEqual(["overdue", "done"]);
  });

  it("matches closest first even when a farther reading was taken earlier", () => {
    const r = computeSlotStatuses({
      check: bp,
      slots: day,
      logs: [],
      events: [reading("early", "2026-10-02T11:45:00.000Z"), reading("near", "2026-10-02T12:04:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r[1]).toMatchObject({ status: "done", eventId: "near" });
  });

  it("an entry equally far from two slots goes to the earlier one", () => {
    const slots = [at("2026-10-02T12:00:00.000Z"), at("2026-10-02T12:40:00.000Z")];
    const r = computeSlotStatuses({
      check: bp,
      slots,
      logs: [],
      events: [reading("e1", "2026-10-02T12:20:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r.map((x) => x.status)).toEqual(["done", "overdue"]);
  });

  it("two entries can complete two neighbouring slots, each taking its nearest", () => {
    const slots = [at("2026-10-02T12:00:00.000Z"), at("2026-10-02T12:40:00.000Z")];
    const r = computeSlotStatuses({
      check: bp,
      slots,
      logs: [],
      events: [reading("a", "2026-10-02T12:10:00.000Z"), reading("b", "2026-10-02T12:35:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r.map((x) => [x.status, x.eventId])).toEqual([["done", "a"], ["done", "b"]]);
  });

  it("does not depend on the order the entries or slots arrive in", () => {
    const events = [reading("a", "2026-10-02T12:10:00.000Z"), reading("b", "2026-10-02T12:10:00.000Z"), reading("c", "2026-10-02T15:50:00.000Z")];
    const forward = computeSlotStatuses({ check: bp, slots: day, logs: [], events, now: at("2026-10-03T00:00:00.000Z") });
    const reversed = computeSlotStatuses({
      check: bp,
      slots: [...day].reverse(),
      logs: [],
      events: [...events].reverse(),
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(reversed).toEqual(forward);
    // Equal distance: the lower id wins, deterministically.
    expect(forward[1]!.eventId).toBe("a");
  });
});

describe("explicit logs win over inferred matches", () => {
  const log = (over: Partial<CheckSlotLog> & Pick<CheckSlotLog, "scheduledAt" | "status">): CheckSlotLog => ({
    id: "log-1",
    healthEventId: null,
    ...over,
  });

  it("a deliberate skip stays skipped even with a matching entry", () => {
    const r = computeSlotStatuses({
      check: bp,
      slots: day,
      logs: [log({ scheduledAt: NOON, status: "skipped" })],
      events: [reading("e1", "2026-10-02T12:05:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r[1]).toMatchObject({ status: "skipped", source: "log", logId: "log-1", eventId: null });
  });

  it("an answered slot does not use up a nearby entry that completes the next open slot", () => {
    // The 12:00 slot was skipped on purpose. The 12:05 reading is nearest to it, but a skipped slot
    // is answered, so the reading still completes the open 12:20 slot, 15 minutes away.
    const slots = [at("2026-10-02T12:00:00.000Z"), at("2026-10-02T12:20:00.000Z")];
    const r = computeSlotStatuses({
      check: bp,
      slots,
      logs: [log({ scheduledAt: slots[0]!, status: "skipped" })],
      events: [reading("e1", "2026-10-02T12:05:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r.map((x) => [x.status, x.source])).toEqual([["skipped", "log"], ["done", "event"]]);
  });

  it("a linked entry counts however far from the slot it was taken", () => {
    const r = computeSlotStatuses({
      check: bp,
      slots: day,
      logs: [log({ scheduledAt: NOON, status: "done", healthEventId: "yesterday" })],
      events: [reading("yesterday", "2026-10-01T07:41:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r[1]).toMatchObject({ status: "done", source: "log", eventId: "yesterday" });
  });

  it("an entry linked to one slot is never also used to infer another", () => {
    // 12:10 is linked to the 12:00 slot; it must not also complete the nearby 12:20 slot.
    const slots = [at("2026-10-02T12:00:00.000Z"), at("2026-10-02T12:20:00.000Z")];
    const r = computeSlotStatuses({
      check: bp,
      slots,
      logs: [log({ scheduledAt: slots[0]!, status: "done", healthEventId: "e1" })],
      events: [reading("e1", "2026-10-02T12:10:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r.map((x) => x.status)).toEqual(["done", "overdue"]);
  });

  it("an entry linked to a slot outside the range is still spoken for", () => {
    // The log is for tomorrow's slot, which is not in `slots`, but its entry is today's 12:05.
    const r = computeSlotStatuses({
      check: bp,
      slots: day,
      logs: [log({ scheduledAt: at("2026-10-03T08:00:00.000Z"), status: "done", healthEventId: "e1" })],
      events: [reading("e1", "2026-10-02T12:05:00.000Z")],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r[1]!.status).toBe("overdue");
  });

  it("a missed log is reported as missed, and ignores slots it does not belong to", () => {
    const r = computeSlotStatuses({
      check: bp,
      slots: day,
      logs: [
        log({ id: "m", scheduledAt: day[0]!, status: "missed" }),
        log({ id: "stray", scheduledAt: at("2026-10-02T09:00:00.000Z"), status: "skipped" }),
      ],
      events: [],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ status: "missed", logId: "m" });
  });

  it("treats a log at 12:00:07 as the 12:00 slot", () => {
    const r = computeSlotStatuses({
      check: bp,
      slots: day,
      logs: [log({ scheduledAt: at("2026-10-02T12:00:07.000Z"), status: "skipped" })],
      events: [],
      now: at("2026-10-03T00:00:00.000Z"),
    });
    expect(r[1]!.status).toBe("skipped");
  });
});

describe("the clock: upcoming, due, overdue", () => {
  const at12 = (iso: string) => statuses({ now: at(iso) })[1];

  it("is upcoming before the slot, due from the slot through the tolerance window, then overdue", () => {
    expect(at12("2026-10-02T11:59:59.000Z")).toBe("upcoming");
    expect(at12("2026-10-02T12:00:00.000Z")).toBe("due");
    expect(at12("2026-10-02T12:29:59.000Z")).toBe("due");
    expect(at12("2026-10-02T12:30:00.000Z")).toBe("overdue");
    expect(at12("2026-10-02T23:00:00.000Z")).toBe("overdue");
  });

  it("answers a whole day at once", () => {
    expect(statuses({ now: at("2026-10-02T13:00:00.000Z") })).toEqual(["overdue", "overdue", "upcoming", "upcoming"]);
  });
});

describe("eventQualifiesForCheck", () => {
  it("needs the same person and kind, and every required metric", () => {
    expect(eventQualifiesForCheck(reading("e", "2026-10-02T12:00:00.000Z"), bp)).toBe(true);
    expect(eventQualifiesForCheck(reading("e", "2026-10-02T12:00:00.000Z", { memberId: "mom" }), bp)).toBe(false);
    expect(eventQualifiesForCheck(reading("e", "2026-10-02T12:00:00.000Z", { type: "pain" }), bp)).toBe(false);
    expect(eventQualifiesForCheck(reading("e", "2026-10-02T12:00:00.000Z", { metrics: undefined }), bp)).toBe(false);
    expect(eventQualifiesForCheck(reading("e", "2026-10-02T12:00:00.000Z", { metrics: undefined }), { eventType: "vitals", memberId: "ally" })).toBe(true);
  });
});

describe("matchEventsToSlots", () => {
  it("honours a custom tolerance", () => {
    const slots = [NOON];
    const events = [reading("e", "2026-10-02T12:10:00.000Z")];
    expect(matchEventsToSlots({ slots, events, toleranceMs: 5 * MIN }).size).toBe(0);
    expect(matchEventsToSlots({ slots, events, toleranceMs: 10 * MIN }).size).toBe(1);
  });
});

describe("suggestAttachments", () => {
  // A check at 8:00, 12:00, 6:00 pm and 9:00 pm in Chicago (CDT, UTC-5) on 2026-10-13.
  const slot8 = at("2026-10-13T13:00:00Z");
  const slot12 = at("2026-10-13T17:00:00Z");
  const slot18 = at("2026-10-13T23:00:00Z");
  const slot21 = at("2026-10-14T02:00:00Z");
  const all = [slot8, slot12, slot18, slot21];
  const ids = (m: Map<number, CheckSlotEvent>) => Object.fromEntries([...m].map(([t, e]) => [new Date(t).toISOString(), e.id]));

  it("offers an early reading to the next check when no other check is near it", () => {
    // 5:24 am: 2h36 before the 8:00 slot, and nothing else within 4 hours.
    const out = suggestAttachments({ openSlots: all, events: [reading("early", "2026-10-13T10:24:00Z")] });
    expect(ids(out)).toEqual({ "2026-10-13T13:00:00.000Z": "early" });
  });

  it("offers a reading between two checks to the closer one", () => {
    // 3:10 pm: 3h10 after noon, 2h50 before 6:00 pm.
    const out = suggestAttachments({ openSlots: all, events: [reading("mid", "2026-10-13T20:10:00Z")] });
    expect(ids(out)).toEqual({ "2026-10-13T23:00:00.000Z": "mid" });
  });

  it("offers a late reading to the check it follows", () => {
    // 8:56 am is 56 minutes after 8:00, and over 3 hours from noon.
    const out = suggestAttachments({ openSlots: all, events: [reading("late", "2026-10-13T13:56:00Z")] });
    expect(ids(out)).toEqual({ "2026-10-13T13:00:00.000Z": "late" });
  });

  it("sends a tie to the earlier slot", () => {
    // 10:00 am is 2h from both 8:00 and noon.
    const out = suggestAttachments({ openSlots: [slot8, slot12], events: [reading("tie", "2026-10-13T15:00:00Z")] });
    expect(ids(out)).toEqual({ "2026-10-13T13:00:00.000Z": "tie" });
  });

  it("offers each reading to one slot only, and each slot one reading", () => {
    // Three readings around the 8:00 slot (last night's 5:24 and 6:02, and 8:56): the closest takes it,
    // the others are not offered a slot that is already spoken for.
    const out = suggestAttachments({
      openSlots: all,
      events: [
        reading("a", "2026-10-13T10:24:00Z"),
        reading("b", "2026-10-13T11:02:00Z"),
        reading("c", "2026-10-13T13:56:00Z"),
      ],
    });
    expect(ids(out)).toEqual({ "2026-10-13T13:00:00.000Z": "c" });
  });

  it("does not reach past the radius", () => {
    const justOut = new Date(slot8.getTime() - CHECK_ATTACH_SUGGEST_RADIUS_MS - MIN);
    expect(suggestAttachments({ openSlots: [slot8], events: [reading("far", justOut.toISOString())] }).size).toBe(0);
    const justIn = new Date(slot8.getTime() - CHECK_ATTACH_SUGGEST_RADIUS_MS);
    expect(suggestAttachments({ openSlots: [slot8], events: [reading("edge", justIn.toISOString())] }).size).toBe(1);
  });

  it("offers nothing when there are no open slots or no readings", () => {
    expect(suggestAttachments({ openSlots: [], events: [reading("r", "2026-10-13T13:00:00Z")] }).size).toBe(0);
    expect(suggestAttachments({ openSlots: all, events: [] }).size).toBe(0);
    expect(suggestAttachments({ openSlots: all, events: [reading("untimed", null)] }).size).toBe(0);
  });
});

describe("which instants are slots", () => {
  const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];

  it("drops slots inside a pause and after deletion, keeps the rest", () => {
    const slots = scheduledCheckSlots({
      times: ["08:00", "20:00"],
      dates,
      timeZone: "UTC",
      pauses: [{ pausedAt: at("2026-10-02T00:00:00.000Z"), resumedAt: at("2026-10-02T12:00:00.000Z") }],
    });
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-10-01T08:00:00.000Z",
      "2026-10-01T20:00:00.000Z",
      "2026-10-02T20:00:00.000Z",
      "2026-10-03T08:00:00.000Z",
      "2026-10-03T20:00:00.000Z",
    ]);

    const deleted = scheduledCheckSlots({
      times: ["08:00", "20:00"],
      dates,
      timeZone: "UTC",
      deletedAt: at("2026-10-02T10:00:00.000Z"),
    });
    expect(deleted.map((s) => s.toISOString())).toEqual([
      "2026-10-01T08:00:00.000Z",
      "2026-10-01T20:00:00.000Z",
      "2026-10-02T08:00:00.000Z",
    ]);
  });

  it("has no slots while still paused (a check created paused, or paused with no resume)", () => {
    const open = scheduledCheckSlots({
      times: ["08:00"],
      dates,
      timeZone: "UTC",
      pauses: [{ pausedAt: at("2026-10-01T00:00:00.000Z"), resumedAt: null }],
    });
    expect(open).toEqual([]);
  });

  it("honours weekdays and the start / end dates", () => {
    const slots = scheduledCheckSlots({
      times: ["09:00"],
      daysOfWeek: [5], // Friday
      startDate: "2026-10-02",
      endDate: "2026-10-03",
      dates,
      timeZone: "UTC",
    });
    expect(slots.map((s) => s.toISOString())).toEqual(["2026-10-02T09:00:00.000Z"]);
  });

  it("excludeInactiveInstants matches the medication behaviour", () => {
    const days = [1, 2, 3].map((d) => at(`2026-09-0${d}T12:00:00.000Z`));
    expect(excludeInactiveInstants(days, [], null)).toHaveLength(3);
    expect(excludeInactiveInstants(days, [], at("2026-09-02T12:00:00.000Z"))).toHaveLength(1);
  });
});

describe("time zones", () => {
  it("keeps the local wall time across the spring-forward day", () => {
    // America/Chicago: DST starts 2026-03-08. 08:00 local is 14:00Z before, 13:00Z after.
    const slots = scheduledCheckSlots({
      times: ["08:00"],
      dates: ["2026-03-07", "2026-03-08", "2026-03-09"],
      timeZone: "America/Chicago",
    });
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
    ]);
    // A reading at 8:05 local on the DST day completes that day's slot, not a neighbouring one.
    const r = computeSlotStatuses({
      check: { eventType: "pain", memberId: "ally" },
      slots,
      logs: [],
      events: [{ id: "e", memberId: "ally", type: "pain", startedAt: at("2026-03-08T13:05:00.000Z") }],
      now: at("2026-03-10T00:00:00.000Z"),
    });
    expect(r.map((x) => x.status)).toEqual(["overdue", "done", "overdue"]);
  });

  it("the same schedule is different instants in the household and the device time zone", () => {
    const base = { times: ["08:00"], dates: ["2026-10-02"] };
    const chicago = scheduledCheckSlots({ ...base, timeZone: "America/Chicago" })[0]!;
    const newYork = scheduledCheckSlots({ ...base, timeZone: "America/New_York" })[0]!;
    expect(chicago.toISOString()).toBe("2026-10-02T13:00:00.000Z");
    expect(newYork.toISOString()).toBe("2026-10-02T12:00:00.000Z");

    // A reading at 8:05 Chicago time completes the Chicago slot but not the New York one.
    const events: CheckSlotEvent[] = [{ id: "e", memberId: "ally", type: "pain", startedAt: at("2026-10-02T13:05:00.000Z") }];
    const check = { eventType: "pain", memberId: "ally" };
    const now = at("2026-10-03T00:00:00.000Z");
    expect(computeSlotStatuses({ check, slots: [chicago], logs: [], events, now })[0]!.status).toBe("done");
    expect(computeSlotStatuses({ check, slots: [newYork], logs: [], events, now })[0]!.status).toBe("overdue");
  });
});

describe("interval checks", () => {
  const schedule = parseIntervalSchedule(
    JSON.stringify({
      everyMinutes: 240,
      anchor: "fixed_start",
      fixedStartTime: "08:00",
      intervalFrom: "schedule_grid",
      stop: { mode: "midnight" },
    }),
  )!;
  const base = {
    schedule,
    dates: ["2026-10-02"],
    today: "2026-10-02",
    now: at("2026-10-02T09:00:00.000Z"),
    timeZone: "UTC",
  };

  it("offers the next pending slot on the grid", () => {
    expect(intervalCheckSlots({ ...base, logs: [] }).map((s) => s.toISOString())).toEqual(["2026-10-02T08:00:00.000Z"]);
    // Once the 08:00 slot is answered, the next one on the grid is pending.
    const answered = [{ scheduledAt: at("2026-10-02T08:00:00.000Z"), loggedAt: at("2026-10-02T08:10:00.000Z"), status: "taken" }];
    expect(intervalCheckSlots({ ...base, logs: answered }).map((s) => s.toISOString())).toEqual(["2026-10-02T12:00:00.000Z"]);
  });

  it("offers no slot on a day outside the start / end dates or while paused", () => {
    expect(intervalCheckSlots({ ...base, logs: [], startDate: "2026-10-03" })).toEqual([]);
    expect(intervalCheckSlots({ ...base, logs: [], endDate: "2026-10-01" })).toEqual([]);
    expect(
      intervalCheckSlots({ ...base, logs: [], pauses: [{ pausedAt: at("2026-10-02T00:00:00.000Z"), resumedAt: null }] }),
    ).toEqual([]);
  });

  it("starts from the first reading when the anchor is first_taken, today only", () => {
    const first = parseIntervalSchedule(
      JSON.stringify({ everyMinutes: 240, anchor: "first_taken", intervalFrom: "last_taken", stop: { mode: "midnight" } }),
    )!;
    const today = intervalCheckSlots({ ...base, schedule: first, logs: [] });
    expect(today).toHaveLength(1);
    expect(today[0]!.toISOString()).toBe(base.now.toISOString());
    const otherDay = intervalCheckSlots({ ...base, schedule: first, dates: ["2026-10-03"], logs: [] });
    expect(otherDay).toEqual([]);
  });
});
