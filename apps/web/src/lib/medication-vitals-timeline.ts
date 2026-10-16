import type { VitalsChart } from "./vitals-trend-charts";

const DAY = 86_400_000;

export function timelineDays(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  return Array.from({ length: Math.min(366, Math.round((end - start) / DAY) + 1) }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
}

export function timelineReadingRows(chart: VitalsChart, days: string[], timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  return chart.rows.filter((r) => days.includes(r.date)).map((row) => {
    let fraction = 0.5;
    if (row.at) {
      const parts = formatter.formatToParts(new Date(row.at));
      const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
      fraction = (get("hour") * 3600 + get("minute") * 60 + get("second")) / 86400;
    }
    return { ...row, x: days.indexOf(row.date) + fraction };
  }).sort((a, b) => a.x - b.x);
}

export function doseDaySummary(point?: { taken: number; skipped: number; missed: number; pending: number; prn: number }) {
  return point ? `${point.taken} taken, ${point.skipped} skipped, ${point.missed} missed, ${point.pending} pending, ${point.prn} as-needed` : "No scheduled dose or dose record";
}
