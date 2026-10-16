import { describe, expect, it } from "vitest";
import { doseDaySummary, timelineDays, timelineReadingRows } from "./medication-vitals-timeline";
import type { VitalsChart } from "./vitals-trend-charts";

describe("medication and vitals timeline", () => {
  it("includes days with no readings, preserving date spacing across a month boundary", () => {
    expect(timelineDays("2026-09-30", "2026-10-02")).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(timelineDays("2026-10-02", "2026-09-30")).toEqual([]);
  });

  it("keeps each reading and places it on its household date and time, with no invented gap readings", () => {
    const chart = { rows: [
      { date: "2026-10-01", at: "2026-10-02T02:00:00Z", value: 170 },
      { date: "2026-10-01", at: "2026-10-01T13:00:00Z", value: 120 },
      { date: "2026-10-03", value: 130 },
    ] } as unknown as VitalsChart;
    const rows = timelineReadingRows(chart, timelineDays("2026-10-01", "2026-10-03"), "America/Chicago");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ value: 120 });
    expect(rows[0]!.x).toBeCloseTo(8 / 24);
    expect(rows[1]).toMatchObject({ value: 170 });
    expect(rows[1]!.x).toBeCloseTo(21 / 24);
    expect(rows[2]!.x).toBe(2.5);
    expect(rows.some((r) => r.date === "2026-10-02")).toBe(false);
  });

  it("does not label missing data as missed medication", () => {
    expect(doseDaySummary()).toBe("No scheduled dose or dose record");
    expect(doseDaySummary({ taken: 1, skipped: 0, missed: 1, pending: 1, prn: 0 })).toContain("1 missed, 1 pending");
  });
});
