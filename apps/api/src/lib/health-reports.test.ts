import { describe, expect, it } from "vitest";
import {
  applyHealthEventTypeFilter,
  applyHealthMemberFilter,
  buildPrnFrequencyByDay,
  buildTodayDoseRows,
  computeExpectedScheduledAdherence,
  enumerateScheduledDoseInstants,
  eventOverlapsReportRange,
  formatHealthInstantLabel,
  formatHealthWhenLabel,
  formatMedScheduleSummary,
  groupHealthEvents,
  HEALTH_EVENT_HISTORY_CAP,
  isoDatesInInclusiveRange,
  normalizeHealthEventType,
  normalizeHealthReportGroupBy,
  type HealthReportEventItem,
  buildMedicationMarkers,
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
      startedAtLabel: "Jul 10, 2026, 12:00 PM",
      endedAt: null,
      endedAtLabel: null,
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
      startedAtLabel: "Jul 10, 2026, 3:00 PM",
      endedAt: null,
      endedAtLabel: null,
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
      startedAtLabel: "Jul 11, 2026, 9:00 AM",
      endedAt: null,
      endedAtLabel: null,
      durationKind: "single_day",
      ongoing: false,
      localDate: "2026-07-11",
    },
  ];

  it("normalizes event types and rejects unknown values", () => {
    expect(normalizeHealthEventType("sickness")).toBe("sickness");
    expect(normalizeHealthEventType("exercise")).toBe("exercise");
    expect(normalizeHealthEventType("pain")).toBe("pain");
    expect(normalizeHealthEventType("food_intake")).toBe("food_intake");
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

describe("health report timestamps + schedule copy", () => {
  it("formats instants with date and time in the household timezone", () => {
    expect(formatHealthInstantLabel("2026-07-10T19:30:00.000Z", "America/Chicago")).toBe(
      "Jul 10, 2026, 2:30 PM",
    );
  });

  it("omits midnight for date-only events", () => {
    expect(formatHealthWhenLabel("2026-07-10T05:00:00.000Z", "America/Chicago")).toBe("Jul 10, 2026");
    expect(formatHealthWhenLabel("2026-07-10T19:30:00.000Z", "America/Chicago")).toBe(
      "Jul 10, 2026, 2:30 PM",
    );
  });

  it("summarizes scheduled, PRN, and interval instructions", () => {
    expect(formatMedScheduleSummary("prn", "{}")).toBe("As needed (PRN)");
    expect(formatMedScheduleSummary("otc", "{}")).toBe("As needed (OTC)");
    expect(
      formatMedScheduleSummary("scheduled", JSON.stringify({ times: ["08:00", "20:00"] }), "UTC"),
    ).toBe("Daily at 8:00 AM, 8:00 PM");
    expect(
      formatMedScheduleSummary(
        "interval",
        JSON.stringify({
          everyMinutes: 240,
          anchor: "first_taken",
          intervalFrom: "last_taken",
          stop: { mode: "max_doses", maxDoses: 4 },
        }),
        "UTC",
      ),
    ).toContain("every 4 hours");
  });
});

describe("today dose rows", () => {
  const med = {
    id: "m1",
    name: "Amoxicillin",
    dosage: "400mg",
    memberId: "mem1",
    memberLabel: "Alex",
    scheduleKind: "scheduled",
    scheduleJson: JSON.stringify({ times: ["08:00"] }),
    startDate: null,
    endDate: null,
    enabled: true,
  };

  it("marks taken scheduled slots with timestamps", () => {
    const takenAt = new Date("2026-07-01T08:00:00.000Z");
    const rows = buildTodayDoseRows({
      date: "2026-07-01",
      timeZone: "UTC",
      now: new Date("2026-07-01T12:00:00.000Z"),
      meds: [med],
      logs: [
        {
          medicationId: "m1",
          status: "taken",
          scheduledAt: takenAt,
          loggedAt: new Date("2026-07-01T08:05:00.000Z"),
          notes: null,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "taken",
      dosage: "400mg",
      loggedAtLabel: "Jul 1, 2026, 8:05 AM",
    });
    expect(rows[0]?.scheduledAtLabel).toContain("8:00 AM");
  });

  it("includes PRN taken rows with the log timestamp", () => {
    const rows = buildTodayDoseRows({
      date: "2026-07-01",
      timeZone: "UTC",
      now: new Date("2026-07-01T12:00:00.000Z"),
      meds: [{ ...med, scheduleKind: "prn", scheduleJson: "{}" }],
      logs: [
        {
          medicationId: "m1",
          status: "taken",
          scheduledAt: null,
          loggedAt: new Date("2026-07-01T15:40:00.000Z"),
          notes: "headache",
        },
      ],
    });
    expect(rows).toMatchObject([
      { status: "prn", statusLabel: "PRN taken", loggedAtLabel: "Jul 1, 2026, 3:40 PM" },
    ]);
  });
});

describe("buildMedicationMarkers", () => {
  const med = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    name: "Lisinopril",
    memberId: "mem1",
    memberLabel: "Ally",
    startDate: null as string | null,
    endDate: null as string | null,
    deletedAt: null as Date | null,
    ...over,
  });
  const range = { from: "2026-10-01", to: "2026-10-31", timeZone: "America/Denver" };

  it("marks start and stop dates that fall inside the range, oldest first", () => {
    const markers = buildMedicationMarkers({
      meds: [med({ startDate: "2026-10-10", endDate: "2026-10-20" }), med({ id: "m2", name: "Aspirin", startDate: "2026-09-01" })],
      pausesByMed: new Map(),
      ...range,
    });
    expect(markers.map((m) => [m.date, m.kind, m.name])).toEqual([
      ["2026-10-10", "start", "Lisinopril"],
      ["2026-10-20", "stop", "Lisinopril"],
    ]);
  });

  it("treats a deleted medication as stopped on the day it was deleted, unless it has an end date", () => {
    const deletedAt = new Date("2026-10-15T20:00:00Z");
    const deleted = buildMedicationMarkers({ meds: [med({ deletedAt })], pausesByMed: new Map(), ...range });
    expect(deleted).toMatchObject([{ date: "2026-10-15", kind: "stop" }]);
    const ended = buildMedicationMarkers({ meds: [med({ deletedAt, endDate: "2026-10-12" })], pausesByMed: new Map(), ...range });
    expect(ended).toMatchObject([{ date: "2026-10-12", kind: "stop" }]);
  });

  it("marks pauses and resumes in the household's time zone", () => {
    const markers = buildMedicationMarkers({
      meds: [med()],
      // 03:00 UTC on the 6th is still the evening of the 5th in Denver.
      pausesByMed: new Map([["m1", [{ pausedAt: new Date("2026-10-06T03:00:00Z"), resumedAt: new Date("2026-11-02T12:00:00Z") }]]]),
      ...range,
    });
    expect(markers).toMatchObject([{ date: "2026-10-05", kind: "pause" }]);
  });
});
