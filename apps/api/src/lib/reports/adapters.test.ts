import { describe, expect, it } from "vitest";
import {
  healthExerciseToCanonical,
  healthNutritionToCanonical,
  healthMedicationListToCanonical,
  healthMedicationsToCanonical,
  healthOverviewToCanonical,
  healthPainToCanonical,
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
  exerciseTrend: { points: [{ weekStart: "2026-07-06", totalMinutes: 90, sessionCount: 3 }] },
  exerciseByActivity: [{ activity: "Running", totalMinutes: 90, sessionCount: 3 }],
  painTrend: [
    {
      bodyRegion: "lower_back",
      bodyRegionLabel: "Lower back",
      points: [{ eventId: "e2", date: "2026-07-12", severity: 6 }],
    },
  ],
  painByRegion: [{ bodyRegion: "lower_back", bodyRegionLabel: "Lower back", count: 1 }],
  nutritionTrend: {
    points: [
      { date: "2026-07-12", calories: 650, proteinG: 44, carbsG: 45, fatG: 8.5, entryCount: 2 },
    ],
  },
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

  it("builds a weekly exercise volume + by-activity breakdown", () => {
    const report = healthExerciseToCanonical(sample);
    expect(report.kind).toBe("exercise");
    const summary = report.sections.find((s) => s.key === "summary");
    expect(summary?.stats).toEqual([
      { label: "Sessions", value: "3" },
      { label: "Total minutes", value: "90" },
    ]);
    const weekly = report.sections.find((s) => s.key === "weekly-volume")?.tables?.[0];
    expect(weekly?.columns).toEqual(["Week of", "Sessions", "Total minutes"]);
    expect(weekly?.rows[0]).toEqual(["Jul 6, 2026", 3, 90]);
    const byActivity = report.sections.find((s) => s.key === "by-activity")?.tables?.[0];
    expect(byActivity?.rows[0]).toEqual(["Running", 3, 90]);
  });

  it("builds a pain body-region frequency + severity trend", () => {
    const report = healthPainToCanonical(sample);
    expect(report.kind).toBe("pain");
    const summary = report.sections.find((s) => s.key === "summary");
    expect(summary?.stats).toEqual([
      { label: "Logged check-ins", value: "1" },
      { label: "Body regions affected", value: "1" },
    ]);
    const byRegion = report.sections.find((s) => s.key === "by-region")?.tables?.[0];
    expect(byRegion?.rows[0]).toEqual(["Lower back", 1]);
    const trend = report.sections.find((s) => s.key === "severity-trend")?.tables?.[0];
    expect(trend?.label).toBe("Lower back");
    expect(trend?.rows[0]).toEqual(["Jul 12, 2026", 6]);
  });

  it("builds a daily calorie + macro rollup", () => {
    const report = healthNutritionToCanonical(sample);
    expect(report.kind).toBe("nutrition");
    const summary = report.sections.find((s) => s.key === "summary");
    expect(summary?.stats).toEqual([
      { label: "Days logged", value: "1" },
      { label: "Food items logged", value: "2" },
      { label: "Average daily calories", value: "650" },
    ]);
    const daily = report.sections.find((s) => s.key === "daily-totals")?.tables?.[0];
    expect(daily?.columns).toEqual(["Date", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)"]);
    expect(daily?.rows[0]).toEqual(["Jul 12, 2026", 650, 44, 45, 8.5]);
  });
});
