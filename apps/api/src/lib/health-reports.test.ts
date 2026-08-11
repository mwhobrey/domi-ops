import { describe, expect, it } from "vitest";
import {
  applyHealthEventTypeFilter,
  applyHealthMemberFilter,
  buildPrnFrequencyByDay,
  computeExpectedScheduledAdherence,
  enumerateScheduledDoseInstants,
  eventOverlapsReportRange,
  groupHealthEvents,
  HEALTH_EVENT_HISTORY_CAP,
  isoDatesInInclusiveRange,
  normalizeHealthEventType,
  normalizeHealthReportGroupBy,
  type HealthReportEventItem,
} from "./health-reports.js";

describe("eventOverlapsReportRange", () => {
  const tz = "UTC";

  it("includes events whose local date is in range", () => {
    expect(
      eventOverlapsReportRange(
        {
          startedAt: new Date("2026-07-10T15:00:00.000Z"),
          createdAt: new Date("2026-07-10T15:00:00.000Z"),
          endedAt: null,
          durationKind: "single_day",
        },
        "2026-07-01",
        "2026-07-31",
        tz,
        "2026-07-16",
      ),
    ).toBe(true);
  });

  it("excludes events outside the range", () => {
    expect(
      eventOverlapsReportRange(
        {
          startedAt: new Date("2026-06-01T12:00:00.000Z"),
          createdAt: new Date("2026-06-01T12:00:00.000Z"),
          endedAt: null,
          durationKind: "single_day",
        },
        "2026-07-01",
        "2026-07-31",
        tz,
        "2026-07-16",
      ),
    ).toBe(false);
  });

  it("includes ongoing events that overlap the window", () => {
    expect(
      eventOverlapsReportRange(
        {
          startedAt: new Date("2026-06-15T12:00:00.000Z"),
          createdAt: new Date("2026-06-15T12:00:00.000Z"),
          endedAt: null,
          durationKind: "ongoing",
        },
        "2026-07-01",
        "2026-07-31",
        tz,
        "2026-07-16",
      ),
    ).toBe(true);
  });
});

describe("applyHealthMemberFilter", () => {
  const rows = [
    { id: "1", memberId: "a" },
    { id: "2", memberId: "b" },
    { id: "3", memberId: "a" },
  ];

  it("returns all rows when memberId omitted", () => {
    expect(applyHealthMemberFilter(rows, null)).toEqual(rows);
    expect(applyHealthMemberFilter(rows, "")).toEqual(rows);
  });

  it("filters to the selected member", () => {
    expect(applyHealthMemberFilter(rows, "a").map((r) => r.id)).toEqual(["1", "3"]);
  });
});

describe("event type filter + grouping", () => {
  const events: HealthReportEventItem[] = [
    {
      id: "1",
      title: "Fever",
      type: "sickness",
      typeLabel: "Sickness",
      memberId: "a",
      memberLabel: "Alex",
      notes: null,
      startedAt: "2026-07-10T12:00:00.000Z",
      endedAt: null,
      durationKind: "single_day",
      ongoing: false,
      localDate: "2026-07-10",
    },
    {
      id: "2",
      title: "Checkup",
      type: "appointment",
      typeLabel: "Appointment",
      memberId: "a",
      memberLabel: "Alex",
      notes: null,
      startedAt: "2026-07-10T15:00:00.000Z",
      endedAt: null,
      durationKind: "single_day",
      ongoing: false,
      localDate: "2026-07-10",
    },
    {
      id: "3",
      title: "Cough",
      type: "symptom",
      typeLabel: "Symptom",
      memberId: "b",
      memberLabel: "Blair",
      notes: null,
      startedAt: "2026-07-11T09:00:00.000Z",
      endedAt: null,
      durationKind: "single_day",
      ongoing: false,
      localDate: "2026-07-11",
    },
  ];

  it("normalizes event types and rejects unknown values", () => {
    expect(normalizeHealthEventType("sickness")).toBe("sickness");
    expect(normalizeHealthEventType("nope")).toBeNull();
    expect(normalizeHealthEventType("")).toBeNull();
  });

  it("filters by event type", () => {
    expect(applyHealthEventTypeFilter(events, "appointment").map((e) => e.id)).toEqual(["2"]);
    expect(applyHealthEventTypeFilter(events, null)).toEqual(events);
  });

  it("groups by date descending", () => {
    const groups = groupHealthEvents(events, "date");
    expect(groups.map((g) => g.key)).toEqual(["2026-07-11", "2026-07-10"]);
    expect(groups[1]?.events.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("groups by event type", () => {
    const groups = groupHealthEvents(events, "eventType");
    expect(groups.map((g) => g.key).sort()).toEqual(["appointment", "sickness", "symptom"]);
  });

  it("defaults groupBy to date", () => {
    expect(normalizeHealthReportGroupBy(undefined)).toBe("date");
    expect(normalizeHealthReportGroupBy("event")).toBe("eventType");
    expect(normalizeHealthReportGroupBy("none")).toBe("none");
  });
});

describe("history caps", () => {
  it("exposes a soft cap above the old 12-row tease", () => {
    expect(HEALTH_EVENT_HISTORY_CAP).toBeGreaterThanOrEqual(100);
  });
});

describe("scheduled adherence helpers", () => {
  it("lists iso dates inclusive", () => {
    expect(isoDatesInInclusiveRange("2026-07-01", "2026-07-03")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  it("enumerates expected times for daily schedule", () => {
    const instants = enumerateScheduledDoseInstants({
      scheduleJson: JSON.stringify({ times: ["08:00", "20:00"] }),
      startDate: null,
      endDate: null,
      from: "2026-07-01",
      to: "2026-07-01",
      timeZone: "UTC",
    });
    expect(instants.map((d) => d.toISOString())).toEqual([
      "2026-07-01T08:00:00.000Z",
      "2026-07-01T20:00:00.000Z",
    ]);
  });

  it("marks past unset expected slots as missed", () => {
    const expected = [
      new Date("2026-07-01T08:00:00.000Z"),
      new Date("2026-07-01T20:00:00.000Z"),
    ];
    const result = computeExpectedScheduledAdherence({
      expected,
      logs: [{ scheduledAt: expected[0]!, status: "taken" }],
      now: new Date("2026-07-02T00:00:00.000Z"),
    });
    expect(result).toMatchObject({
      expected: 2,
      taken: 1,
      skipped: 0,
      missed: 1,
      pending: 0,
      adherencePct: 50,
    });
  });

  it("builds PRN frequency by day/member", () => {
    const rows = buildPrnFrequencyByDay({
      logs: [
        {
          medicationId: "m1",
          loggedAt: new Date("2026-07-02T15:00:00.000Z"),
          scheduledAt: null,
        },
        {
          medicationId: "m1",
          loggedAt: new Date("2026-07-02T18:00:00.000Z"),
          scheduledAt: null,
        },
        {
          medicationId: "m1",
          loggedAt: new Date("2026-07-02T12:00:00.000Z"),
          scheduledAt: new Date("2026-07-02T08:00:00.000Z"),
        },
      ],
      medById: new Map([["m1", { memberId: "mem1" }]]),
      memberLabel: new Map([["mem1", "Alex"]]),
      timeZone: "UTC",
    });
    expect(rows).toEqual([{ date: "2026-07-02", memberId: "mem1", memberLabel: "Alex", count: 2 }]);
  });
});
