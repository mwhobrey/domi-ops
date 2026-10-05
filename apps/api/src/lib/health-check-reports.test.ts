import { describe, expect, it } from "vitest";
import {
  CheckReportRangeError,
  adherenceOutcome,
  assertCheckReportRange,
  completionPercent,
  periodOfDay,
  summarizeBloodPressure,
  type BloodPressureReading,
} from "./health-check-reports.js";
import { bloodPressureToCanonical, checkAdherenceToCanonical } from "./reports/adapters.js";

const reading = (over: Partial<BloodPressureReading> = {}): BloodPressureReading => ({
  eventId: "e",
  date: "2026-10-03",
  timeLabel: "8:00 AM",
  at: "2026-10-03T13:00:00.000Z",
  hour: 8,
  systolic: 120,
  diastolic: 80,
  heartRate: null,
  ...over,
});

describe("adherenceOutcome", () => {
  it("counts answered times and times that passed with nothing recorded", () => {
    expect(adherenceOutcome("done")).toBe("done");
    expect(adherenceOutcome("skipped")).toBe("skipped");
    expect(adherenceOutcome("missed")).toBe("missed");
    // Past the tolerance window with no answer is a miss, whether or not the system wrote it down.
    expect(adherenceOutcome("overdue")).toBe("missed");
  });

  it("does not count a time that is still ahead or only just due", () => {
    expect(adherenceOutcome("upcoming")).toBeNull();
    expect(adherenceOutcome("due")).toBeNull();
  });
});

describe("completionPercent", () => {
  it("is done out of due, rounded, and nothing when nothing was due", () => {
    expect(completionPercent(3, 4)).toBe(75);
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(2, 3)).toBe(67);
    expect(completionPercent(0, 5)).toBe(0);
    expect(completionPercent(0, 0)).toBeNull();
  });
});

describe("periodOfDay", () => {
  it("splits the day into morning, afternoon and evening, with the night belonging to evening", () => {
    expect([4, 5, 11].map(periodOfDay)).toEqual(["Evening", "Morning", "Morning"]);
    expect([12, 17].map(periodOfDay)).toEqual(["Afternoon", "Afternoon"]);
    expect([18, 23, 0, 3].map(periodOfDay)).toEqual(["Evening", "Evening", "Evening", "Evening"]);
  });
});

describe("assertCheckReportRange", () => {
  const code = (from: string, to: string) => {
    try {
      assertCheckReportRange(from, to);
      return null;
    } catch (e) {
      return e instanceof CheckReportRangeError ? e.code : "other";
    }
  };

  it("accepts a sensible range and names what is wrong with a bad one", () => {
    expect(code("2026-10-01", "2026-10-31")).toBeNull();
    expect(code("2026-10-01", "2026-10-01")).toBeNull();
    expect(code("10/01/2026", "2026-10-31")).toBe("invalid_date");
    expect(code("2026-13-40", "2026-10-31")).toBe("invalid_date"); // shaped like a date, not one
    expect(code("2026-10-01", "2026-02-30")).toBe("invalid_date");
    expect(code("2026-10-31", "2026-10-01")).toBe("end_before_start");
    expect(code("2025-01-01", "2026-10-01")).toBe("range_too_large");
    expect(code("2025-10-01", "2026-10-01")).toBeNull(); // 366 days inclusive
  });
});

describe("summarizeBloodPressure", () => {
  it("averages, finds the lowest and highest by systolic, and keeps heart rate optional", () => {
    const s = summarizeBloodPressure([
      reading({ eventId: "a", systolic: 120, diastolic: 80, heartRate: 70 }),
      reading({ eventId: "b", systolic: 130, diastolic: 85, heartRate: 74 }),
      reading({ eventId: "c", systolic: 110, diastolic: 70, heartRate: null }),
    ]);
    expect(s).toMatchObject({ count: 3, avgSystolic: 120, avgDiastolic: 78, avgHeartRate: 72 });
    expect(s.lowest).toMatchObject({ eventId: "c" });
    expect(s.highest).toMatchObject({ eventId: "b" });
  });

  it("breaks a tie on systolic with the diastolic", () => {
    const s = summarizeBloodPressure([
      reading({ eventId: "a", systolic: 130, diastolic: 90 }),
      reading({ eventId: "b", systolic: 130, diastolic: 80 }),
    ]);
    expect(s.lowest?.eventId).toBe("b");
    expect(s.highest?.eventId).toBe("a");
  });

  it("groups by time of day and leaves out the periods with no readings", () => {
    const s = summarizeBloodPressure([
      reading({ hour: 7, systolic: 130, diastolic: 84 }),
      reading({ hour: 9, systolic: 120, diastolic: 80 }),
      reading({ hour: 21, systolic: 110, diastolic: 70 }),
    ]);
    expect(s.byPeriod).toEqual([
      { period: "Morning", count: 2, avgSystolic: 125, avgDiastolic: 82 },
      { period: "Evening", count: 1, avgSystolic: 110, avgDiastolic: 70 },
    ]);
  });

  it("has nothing to say about no readings", () => {
    expect(summarizeBloodPressure([])).toEqual({
      count: 0,
      avgSystolic: null,
      avgDiastolic: null,
      avgHeartRate: null,
      lowest: null,
      highest: null,
      byPeriod: [],
    });
  });
});

describe("the canonical reports", () => {
  it("lays adherence out as a summary, a row per check and the gaps", () => {
    const report = checkAdherenceToCanonical({
      from: "2026-10-01",
      to: "2026-10-03",
      timezone: "UTC",
      totals: { due: 4, done: 2, skipped: 1, missed: 1, completionPercent: 50 },
      byCheck: [
        { checkId: "c", name: "Ally BP", memberId: "m", memberLabel: "Ally", due: 4, done: 2, skipped: 1, missed: 1, completionPercent: 50 },
      ],
      gaps: [
        { date: "2026-10-02", timeLabel: "8:00 AM", scheduledAt: "2026-10-02T08:00:00.000Z", checkName: "Ally BP", memberLabel: "Ally", status: "missed" },
      ],
      gapsTruncated: false,
    });
    expect(report).toMatchObject({ module: "health", kind: "check-adherence", title: "Check adherence — 2026-10-01 to 2026-10-03" });
    expect(report.sections.map((s) => s.key)).toEqual(["summary", "by-check", "gaps"]);
    expect(report.sections[0]!.stats).toContainEqual({ label: "Done out of due", value: "50%" });
    expect(report.sections[1]!.tables![0]!.rows[0]).toEqual(["Ally", "Ally BP", 4, 2, 1, 1, "50%"]);
    expect(report.sections[2]!.tables![0]!.rows[0]![4]).toBe("Missed");
  });

  it("says so when nothing was due, rather than printing empty tables", () => {
    const report = checkAdherenceToCanonical({
      from: "2026-10-01",
      to: "2026-10-03",
      timezone: "UTC",
      totals: { due: 0, done: 0, skipped: 0, missed: 0, completionPercent: null },
      byCheck: [],
      gaps: [],
      gapsTruncated: false,
    });
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0]!.emptyMessage).toContain("No scheduled checks");
    expect(report.sections[0]!.stats).toContainEqual({ label: "Done out of due", value: "—" });
  });

  it("lays blood pressure out per person: summary, time of day, readings", () => {
    const readings = [reading({ systolic: 128, diastolic: 82, heartRate: 72 })];
    const report = bloodPressureToCanonical({
      from: "2026-10-01",
      to: "2026-10-03",
      timezone: "UTC",
      people: [{ memberId: "m", memberLabel: "Ally", summary: summarizeBloodPressure(readings), readings }],
    });
    expect(report).toMatchObject({ kind: "blood-pressure" });
    expect(report.sections.map((s) => s.key)).toEqual(["summary-m", "period-m", "readings-m"]);
    expect(report.sections[0]!.stats).toContainEqual({ label: "Person", value: "Ally" });
    expect(report.sections[0]!.stats).toContainEqual({ label: "Average", value: "128/82" });
    expect(report.sections[2]!.tables![0]!.rows[0]).toEqual([expect.any(String), "8:00 AM", "128/82", "72 bpm"]);
  });

  it("prefixes sections with the person when there are several, and reports an empty range", () => {
    const readings = [reading()];
    const person = (id: string, label: string) => ({
      memberId: id,
      memberLabel: label,
      summary: summarizeBloodPressure(readings),
      readings,
    });
    const several = bloodPressureToCanonical({
      from: "2026-10-01",
      to: "2026-10-03",
      timezone: "UTC",
      people: [person("a", "Ally"), person("b", "Ben")],
    });
    expect(several.sections.map((s) => s.label)).toContain("Ben — Readings");
    const none = bloodPressureToCanonical({ from: "2026-10-01", to: "2026-10-03", timezone: "UTC", people: [] });
    expect(none.sections[0]!.emptyMessage).toContain("No blood pressure readings");
  });
});
