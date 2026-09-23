import type { VitalsTrendEntry } from "./health-report-export";

export type VitalsChart = {
  key: string;
  title: string;
  unit: string;
  readingCount: number;
  series: { key: string; label: string }[];
  /** One row per logged event (x = date); series values may be null. */
  rows: Array<{ date: string } & Record<string, string | number | null>>;
};

const SYSTOLIC = "blood_pressure_systolic";
const DIASTOLIC = "blood_pressure_diastolic";

/** "BP systolic — Ally Whobrey" → "Ally Whobrey"; no suffix → "". */
function memberSuffix(label: string): string {
  const idx = label.lastIndexOf(" — ");
  return idx >= 0 ? label.slice(idx + 3) : "";
}

/**
 * One chart per metric (per member), except blood pressure: systolic and diastolic from the
 * same member share one chart, joined by the log they came from.
 */
export function buildVitalsCharts(trends: VitalsTrendEntry[]): VitalsChart[] {
  const charts: VitalsChart[] = [];
  const pairedBp = new Set<VitalsTrendEntry>();

  for (const sys of trends.filter((t) => t.metric === SYSTOLIC)) {
    const dia = trends.find(
      (t) =>
        t.metric === DIASTOLIC &&
        (t.memberId ?? "") === (sys.memberId ?? "") &&
        (t.points[0]?.unit ?? "") === (sys.points[0]?.unit ?? ""),
    );
    if (!dia) continue;
    pairedBp.add(sys);
    pairedBp.add(dia);
    const byEvent = new Map<string, { date: string; systolic: number | null; diastolic: number | null }>();
    for (const p of sys.points) {
      byEvent.set(p.eventId, { date: p.date, systolic: p.value, diastolic: null });
    }
    for (const p of dia.points) {
      const row = byEvent.get(p.eventId) ?? { date: p.date, systolic: null, diastolic: null };
      row.diastolic = p.value;
      byEvent.set(p.eventId, row);
    }
    const suffix = memberSuffix(sys.metricLabel);
    const rows = [...byEvent.values()].sort((a, b) => a.date.localeCompare(b.date));
    charts.push({
      key: `bp::${sys.memberId ?? ""}`,
      title: suffix ? `Blood pressure — ${suffix}` : "Blood pressure",
      unit: sys.points[0]?.unit ?? "mmHg",
      readingCount: rows.length,
      series: [
        { key: "systolic", label: "Systolic" },
        { key: "diastolic", label: "Diastolic" },
      ],
      rows,
    });
  }

  for (const t of trends) {
    if (pairedBp.has(t)) continue;
    charts.push({
      key: `${t.metric}::${t.memberId ?? ""}::${t.points[0]?.unit ?? ""}`,
      title: t.metricLabel,
      unit: t.points[0]?.unit ?? "",
      readingCount: t.points.length,
      series: [{ key: "value", label: t.metricLabel }],
      rows: t.points.map((p) => ({ date: p.date, value: p.value })),
    });
  }

  return charts;
}
