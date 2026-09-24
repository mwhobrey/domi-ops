import { describe, expect, it } from "vitest";
import { buildVitalsCharts } from "./vitals-trend-charts.js";

const point = (eventId: string, date: string, value: number, unit = "mmHg") => ({
  eventId,
  date,
  value,
  unit,
});

describe("buildVitalsCharts", () => {
  it("combines systolic and diastolic into one blood pressure chart per member", () => {
    const charts = buildVitalsCharts([
      {
        metric: "blood_pressure_systolic",
        memberId: "ally",
        metricLabel: "BP systolic — Ally Whobrey",
        points: [point("e1", "2026-09-22", 105), point("e2", "2026-09-23", 135)],
      },
      {
        metric: "blood_pressure_diastolic",
        memberId: "ally",
        metricLabel: "BP diastolic — Ally Whobrey",
        points: [point("e1", "2026-09-22", 78), point("e2", "2026-09-23", 90)],
      },
      {
        metric: "blood_oxygen",
        memberId: "ally",
        metricLabel: "Blood oxygen — Ally Whobrey",
        points: [point("e3", "2026-09-19", 98, "%")],
      },
    ]);

    expect(charts.map((c) => c.title)).toEqual(["Blood pressure — Ally Whobrey", "Blood oxygen — Ally Whobrey"]);
    expect(charts[0]!.rows).toEqual([
      { date: "2026-09-22", systolic: 105, diastolic: 78 },
      { date: "2026-09-23", systolic: 135, diastolic: 90 },
    ]);
    expect(charts[0]!.series.map((s) => s.label)).toEqual(["Systolic", "Diastolic"]);
  });

  it("never pairs one member's systolic with another member's diastolic", () => {
    const charts = buildVitalsCharts([
      { metric: "blood_pressure_systolic", memberId: "a", metricLabel: "BP systolic — A", points: [point("e1", "2026-09-22", 120)] },
      { metric: "blood_pressure_diastolic", memberId: "b", metricLabel: "BP diastolic — B", points: [point("e2", "2026-09-22", 80)] },
    ]);
    expect(charts.map((c) => c.title)).toEqual(["BP systolic — A", "BP diastolic — B"]);
  });
});
