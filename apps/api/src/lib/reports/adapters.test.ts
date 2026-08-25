import { describe, expect, it } from "vitest";
import {
  healthMedicationListToCanonical,
  healthMedicationsToCanonical,
  healthOverviewToCanonical,
  healthTodayToCanonical,
} from "./adapters.js";

const sample = {
  from: "2026-07-01",
  to: "2026-07-31",
  timezone: "America/Chicago",
  memberId: null,
  eventType: null,
  groupBy: "date" as const,
  medicationId: null,
  scheduleKind: null,
  summary: {
    totalEvents: 1,
    ongoingCount: 0,
    activeMedications: 1,
    scheduledMedications: 1,
    intervalMedications: 0,
    prnMedications: 0,
    dosesLogged: 1,
  },
  vitalsTrend: [],
  eventsByType: [{ type: "appointment", label: "Appointment", count: 1 }],
  eventsByMember: [{ memberId: "a", label: "Alex", count: 1 }],
  medicationAdherence: [
    {
      medicationId: "m1",
      name: "Amoxicillin",
      scheduleKind: "scheduled" as const,
      memberId: "a",
      memberLabel: "Alex",
      taken: 10,
      skipped: 0,
      missed: 2,
      pending: 0,
      expected: 12,
      prn: 0,
      scheduledTotal: 12,
      adherencePct: 83,
    },
  ],
  prnFrequency: [],
  medications: [
    {
      id: "m1",
      name: "Amoxicillin",
      dosage: "400mg",
      instructions: "Take with food",
      scheduleKind: "scheduled" as const,
      scheduleSummary: "Daily at 8:00 AM",
      memberId: "a",
      memberLabel: "Alex",
      enabled: true,
      startDate: null,
      endDate: null,
    },
  ],
  eventHistory: [
    {
      id: "e1",
      title: "Checkup",
      type: "appointment",
      typeLabel: "Appointment",
      memberId: "a",
      memberLabel: "Alex",
      notes: null,
      startedAt: "2026-07-10T19:30:00.000Z",
      startedAtLabel: "Jul 10, 2026, 2:30 PM",
      endedAt: null,
      endedAtLabel: null,
      durationKind: "single_day" as const,
      ongoing: false,
      localDate: "2026-07-10",
    },
  ],
  eventGroups: [],
  medicationLogHistory: [
    {
      id: "l1",
      medicationId: "m1",
      medicationName: "Amoxicillin",
      memberId: "a",
      memberLabel: "Alex",
      status: "taken" as const,
      scheduledAt: "2026-07-10T13:00:00.000Z",
      scheduledAtLabel: "Jul 10, 2026, 8:00 AM",
      loggedAt: "2026-07-10T13:05:00.000Z",
      loggedAtLabel: "Jul 10, 2026, 8:05 AM",
      notes: null,
      prn: false,
    },
  ],
  todayDoses: [
    {
      medicationId: "m1",
      medicationName: "Amoxicillin",
      dosage: "400mg",
      memberId: "a",
      memberLabel: "Alex",
      scheduleKind: "scheduled" as const,
      status: "taken" as const,
      statusLabel: "Taken",
      scheduledAt: "2026-07-10T13:00:00.000Z",
      scheduledAtLabel: "Jul 10, 2026, 8:00 AM",
      loggedAt: "2026-07-10T13:05:00.000Z",
      loggedAtLabel: "Jul 10, 2026, 8:05 AM",
      notes: null,
    },
  ],
  todayDoseDate: "2026-07-10",
  recentEvents: [],
};

describe("health canonical adapters", () => {
  it("keeps events overview free of medication log dumps", () => {
    const report = healthOverviewToCanonical(sample);
    expect(report.kind).toBe("overview");
    expect(report.sections.map((s) => s.key)).toEqual([
      "summary",
      "events-by-type",
      "events-by-member",
      "event-history",
    ]);
    expect(JSON.stringify(report)).not.toContain("Amoxicillin");
    expect(JSON.stringify(report)).toContain("Jul 10, 2026, 2:30 PM");
  });

  it("puts timestamps first on dose history logs", () => {
    const report = healthMedicationsToCanonical(sample);
    expect(report.kind).toBe("medications");
    const logTable = report.sections.find((s) => s.key === "medication-log-history")?.tables?.[0];
    expect(logTable?.columns[0]).toBe("When logged");
    expect(logTable?.rows[0]?.[0]).toBe("Jul 10, 2026, 8:05 AM");
    expect(logTable?.rows[0]?.[1]).toBe("Jul 10, 2026, 8:00 AM");
  });

  it("builds a today dose sheet with time columns", () => {
    const report = healthTodayToCanonical(sample);
    expect(report.kind).toBe("medications-today");
    const table = report.sections.find((s) => s.key === "today-doses")?.tables?.[0];
    expect(table?.columns).toContain("When");
    expect(table?.rows[0]?.[0]).toBe("Jul 10, 2026, 8:00 AM");
    expect(table?.rows[0]?.[4]).toBe("400mg");
  });

  it("builds a clinician medication list with dosage and instructions", () => {
    const report = healthMedicationListToCanonical(sample);
    expect(report.kind).toBe("medication-list");
    const table = report.sections[0]?.tables?.[0];
    expect(table?.columns).toEqual(["Member", "Medication", "Dosage", "Schedule", "Instructions"]);
    expect(table?.rows[0]).toEqual([
      "Alex",
      "Amoxicillin",
      "400mg",
      "Daily at 8:00 AM",
      "Take with food",
    ]);
  });
});
