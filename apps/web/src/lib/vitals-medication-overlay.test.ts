import { describe, expect, it } from "vitest";
import type { VitalsChart } from "./vitals-trend-charts";
import type { MedicationMarker } from "./health-report-export";
import { beforeAfter, chartMarkerLines, markerAnchorDate, markersForChart } from "./vitals-medication-overlay";

const chart = (over: Partial<VitalsChart> = {}): VitalsChart => ({
  key: "bp::mem1",
  memberId: "mem1",
  title: "Blood pressure",
  unit: "mmHg",
  readingCount: 4,
  series: [
    { key: "systolic", label: "Systolic" },
    { key: "diastolic", label: "Diastolic" },
  ],
  rows: [
    { date: "2026-10-01", systolic: 150, diastolic: 95 },
    { date: "2026-10-05", systolic: 146, diastolic: 93 },
    { date: "2026-10-12", systolic: 132, diastolic: 84 },
    { date: "2026-10-20", systolic: 128, diastolic: 82 },
  ],
  ...over,
});
const marker = (over: Partial<MedicationMarker> = {}): MedicationMarker => ({
  medicationId: "m1",
  name: "Lisinopril",
  memberId: "mem1",
  memberLabel: "Ally",
  date: "2026-10-10",
  kind: "start",
  ...over,
});

describe("markersForChart", () => {
  it("keeps only the chart's own member, and none for a chart without one", () => {
    const list = [marker(), marker({ memberId: "mem2" })];
    expect(markersForChart(chart(), list)).toHaveLength(1);
    expect(markersForChart(chart({ memberId: undefined }), list)).toEqual([]);
  });
});

describe("markerAnchorDate", () => {
  it("snaps to the next reading and ignores a date outside the readings", () => {
    expect(markerAnchorDate(chart(), "2026-10-10")).toBe("2026-10-12");
    expect(markerAnchorDate(chart(), "2026-09-01")).toBeNull();
    expect(markerAnchorDate(chart(), "2026-11-01")).toBeNull();
    expect(markerAnchorDate(chart({ rows: [] }), "2026-10-10")).toBeNull();
  });
});

describe("chartMarkerLines", () => {
  it("labels one change by name and merges changes that land on the same reading", () => {
    expect(chartMarkerLines(chart(), [marker()])).toEqual([{ date: "2026-10-12", label: "Started Lisinopril" }]);
    expect(chartMarkerLines(chart(), [marker(), marker({ name: "Aspirin", date: "2026-10-11" })])).toEqual([
      { date: "2026-10-12", label: "2 medication changes" },
    ]);
  });
});

describe("beforeAfter", () => {
  it("averages each series in the 14 days before and after the date", () => {
    const [sys, dia] = beforeAfter(chart(), "2026-10-10");
    expect(sys).toMatchObject({ before: 148, after: 130, beforeCount: 2, afterCount: 2 });
    expect(dia).toMatchObject({ before: 94, after: 83 });
  });

  it("compares equal windows: 14 days either side, the marker's day counting as the first after", () => {
    const rows = [
      { date: "2026-09-26", systolic: 100 }, // 14 days before 10-10: in
      { date: "2026-09-25", systolic: 900 }, // 15 days before: out
      { date: "2026-10-10", systolic: 120 }, // marker day: after
      { date: "2026-10-23", systolic: 140 }, // 13 days after: in
      { date: "2026-10-24", systolic: 900 }, // 14 days after: out
    ];
    const [sys] = beforeAfter(chart({ rows: rows as VitalsChart["rows"] }), "2026-10-10");
    expect(sys).toMatchObject({ before: 100, beforeCount: 1, after: 130, afterCount: 2 });
  });

  it("leaves a side empty rather than inventing it", () => {
    expect(beforeAfter(chart(), "2026-10-01")[0]).toMatchObject({ before: null, beforeCount: 0 });
    expect(beforeAfter(chart(), "2026-10-25")[0]).toMatchObject({ after: null, afterCount: 0 });
  });
});
