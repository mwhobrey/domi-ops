import { describe, expect, it } from "vitest";
import { buildDailyMedicationDoses } from "./health-reports.js";

describe("daily doses for vitals comparison", () => {
  const range = { from: "2026-10-01", to: "2026-10-03", timeZone: "America/Chicago", now: new Date("2026-10-02T15:00:00Z") };
  it("uses household days, infers missed past slots, and leaves future slots pending", () => {
    const taken = new Date("2026-10-02T02:00:00Z");
    expect(buildDailyMedicationDoses({ ...range, expected: [taken, new Date("2026-10-02T13:00:00Z"), new Date("2026-10-02T23:00:00Z")], logs: [{ scheduledAt: taken, loggedAt: taken, status: "taken" }] })).toEqual([
      { date: "2026-10-01", taken: 1, skipped: 0, missed: 0, pending: 0, prn: 0 },
      { date: "2026-10-02", taken: 0, skipped: 0, missed: 1, pending: 1, prn: 0 },
    ]);
  });

  it("keeps skipped and as-needed separate and adds no slots on paused days", () => {
    const at = new Date("2026-10-01T13:00:00Z");
    expect(buildDailyMedicationDoses({ ...range, expected: [at], logs: [{ scheduledAt: at, loggedAt: at, status: "skipped" }, { scheduledAt: null, loggedAt: new Date("2026-10-03T01:00:00Z"), status: "taken" }] })).toEqual([
      { date: "2026-10-01", taken: 0, skipped: 1, missed: 0, pending: 0, prn: 0 },
      { date: "2026-10-02", taken: 0, skipped: 0, missed: 0, pending: 0, prn: 1 },
    ]);
  });

  it("does not invent missed doses for interval or as-needed schedules", () => {
    expect(buildDailyMedicationDoses({ ...range, expected: null, logs: [] })).toEqual([]);
    const at = new Date("2026-10-02T13:00:00Z");
    expect(buildDailyMedicationDoses({ ...range, expected: null, logs: [{ scheduledAt: at, loggedAt: at, status: "taken" }] })).toEqual([{ date: "2026-10-02", taken: 1, skipped: 0, missed: 0, pending: 0, prn: 0 }]);
  });

  it("keeps recorded doses whose scheduled time is absent from the current schedule", () => {
    const at = new Date("2026-10-01T13:00:00Z");
    expect(buildDailyMedicationDoses({ ...range, expected: [], logs: [{ scheduledAt: at, loggedAt: at, status: "taken" }] })).toEqual([
      { date: "2026-10-01", taken: 1, skipped: 0, missed: 0, pending: 0, prn: 0 },
    ]);
  });
});
