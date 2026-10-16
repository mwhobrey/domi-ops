import type { VitalsChart } from "./vitals-trend-charts";
import type { MedicationMarker } from "./health-report-export";

export const MARKER_VERB: Record<MedicationMarker["kind"], string> = {
  start: "Started",
  stop: "Stopped",
  pause: "Paused",
  resume: "Resumed",
};

/** Days of readings compared on each side of a medication marker. */
export const OVERLAY_WINDOW_DAYS = 14;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Markers for the person a chart belongs to. A chart without a member shows none: a marker has to be about the same body. */
export function markersForChart(chart: Pick<VitalsChart, "memberId">, markers: MedicationMarker[]): MedicationMarker[] {
  if (!chart.memberId) return [];
  return markers.filter((m) => m.memberId === chart.memberId);
}

/** The first reading on or after the marker's date, when the marker falls inside the chart's span; otherwise nothing to draw. */
export function markerAnchorDate(chart: Pick<VitalsChart, "rows">, markerDate: string): string | null {
  const dates = chart.rows.map((r) => r.date).sort();
  if (dates.length === 0 || markerDate < dates[0]! || markerDate > dates[dates.length - 1]!) return null;
  return dates.find((d) => d >= markerDate) ?? null;
}

/** One reference line per drawn date; several markers on one day share a label. */
export function chartMarkerLines(
  chart: Pick<VitalsChart, "rows">,
  markers: MedicationMarker[],
): Array<{ date: string; label: string }> {
  const byDate = new Map<string, MedicationMarker[]>();
  for (const marker of markers) {
    const anchor = markerAnchorDate(chart, marker.date);
    if (!anchor) continue;
    byDate.set(anchor, [...(byDate.get(anchor) ?? []), marker]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      label: list.length === 1 ? `${MARKER_VERB[list[0]!.kind]} ${list[0]!.name}` : `${list.length} medication changes`,
    }));
}

export type BeforeAfter = {
  seriesKey: string;
  seriesLabel: string;
  before: number | null;
  after: number | null;
  beforeCount: number;
  afterCount: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The mean of each series over the window before the marker's date and from it onward. It is a
 * description, not a finding: nothing here says the medication caused the difference.
 */
export function beforeAfter(
  chart: Pick<VitalsChart, "rows" | "series">,
  markerDate: string,
  windowDays: number = OVERLAY_WINDOW_DAYS,
): BeforeAfter[] {
  const beforeFrom = addDays(markerDate, -windowDays);
  const afterTo = addDays(markerDate, windowDays);
  return chart.series.map((s) => {
    const before: number[] = [];
    const after: number[] = [];
    for (const row of chart.rows) {
      const v = row[s.key];
      if (typeof v !== "number") continue;
      if (row.date >= beforeFrom && row.date < markerDate) before.push(v);
      else if (row.date >= markerDate && row.date <= afterTo) after.push(v);
    }
    const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    return {
      seriesKey: s.key,
      seriesLabel: s.label,
      before: mean(before),
      after: mean(after),
      beforeCount: before.length,
      afterCount: after.length,
    };
  });
}
