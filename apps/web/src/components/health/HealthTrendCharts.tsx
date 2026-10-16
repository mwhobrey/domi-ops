"use client";

import { LazyCategoryBarChart as CategoryBarChart, LazyTrendLineChart as TrendLineChart } from "../charts/lazy";
import { buildVitalsCharts } from "../../lib/vitals-trend-charts";
import { beforeAfter, chartMarkerLines, MARKER_VERB, markersForChart, OVERLAY_WINDOW_DAYS } from "../../lib/vitals-medication-overlay";
import { SectionHeader } from "../ui";
import { formatReportDate, ReportTable } from "../reports/HealthOverviewReportBody";
import type {
  ExerciseByActivityEntry,
  MedicationMarker,
  ExerciseTrendPoint,
  NutritionTrendPoint,
  PainByRegionEntry,
  PainTrendEntry,
  VitalsTrendEntry,
} from "../../lib/health-report-export";
import { BodyPainMap } from "./BodyPainMap";
import type { HealthPainBodyRegion } from "./health-types";

/**
 * Chart+table sections shared between the full Health report (`HealthOverviewReportBody`,
 * `focus="exercise"|"pain"`, and the vitals trend inside `focus="overview"`) and the leaner
 * `/health` Trends tab — same data, same charts, two different surfaces (WHO-303).
 */

export type VitalsAdherenceRow = {
  medicationId: string;
  name: string;
  memberId?: string;
  scheduleKind: string;
  adherencePct: number | null;
  taken: number;
  missed: number;
};

export function VitalsTrendSection({
  vitalsTrend,
  medicationMarkers = [],
  medicationAdherence = [],
}: {
  vitalsTrend: VitalsTrendEntry[];
  /** When given, medication starts, stops and pauses are drawn on each chart and compared before and after (WHO-460). */
  medicationMarkers?: MedicationMarker[];
  medicationAdherence?: VitalsAdherenceRow[];
}) {
  if (vitalsTrend.length === 0) return null;
  const charts = buildVitalsCharts(vitalsTrend);
  return (
    <section className="space-y-4">
      <SectionHeader title="Vitals trend" />
      {charts.map((chart) => {
        const chartMarkers = markersForChart(chart, medicationMarkers);
        const lines = chartMarkerLines(chart, chartMarkers);
        const adherence = medicationAdherence.filter(
          (a) => a.memberId === chart.memberId && a.scheduleKind !== "prn" && a.adherencePct != null,
        );
        return (
        <div key={chart.key} className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--color-text)]">
            {chart.title}
            <span className="ml-2 font-normal text-[var(--color-text-muted)]">
              ({chart.readingCount} reading{chart.readingCount === 1 ? "" : "s"})
            </span>
          </h3>
          <div className="print:hidden">
            <TrendLineChart
              data={chart.rows.map((row) => ({
                ...row,
                date: formatReportDate(row.date),
                whenLabel: row.whenLabel ?? formatReportDate(row.date),
              }))}
              series={chart.series}
              valueFormatter={(v) => `${v} ${chart.unit}`.trim()}
              height={180}
              autoScaleY
              dedupeXLabels
              tooltipLabelKey="whenLabel"
              markers={lines.map((l) => ({ x: formatReportDate(l.date), label: l.label }))}
            />
          </div>
          {chartMarkers.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                Average of the {OVERLAY_WINDOW_DAYS} days before and after each change. This shows what happened next to what
                changed; it does not show the medication caused it.
              </p>
              <ReportTable
                columns={["Change", "Reading", "Before", "After"]}
                rows={chartMarkers.flatMap((m) =>
                  beforeAfter(chart, m.date).map((b, i) => [
                    i === 0 ? `${formatReportDate(m.date)}: ${MARKER_VERB[m.kind]} ${m.name}` : "",
                    b.seriesLabel,
                    b.before != null ? `${b.before} ${chart.unit} (${b.beforeCount})`.trim() : "No readings",
                    b.after != null ? `${b.after} ${chart.unit} (${b.afterCount})`.trim() : "No readings",
                  ]),
                )}
              />
            </div>
          ) : null}
          {adherence.length > 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              Adherence in this range:{" "}
              {adherence.map((a) => `${a.name} ${a.adherencePct}% (${a.taken} taken, ${a.missed} missed)`).join(" · ")}
            </p>
          ) : null}
          <ReportTable
            columns={["When", ...chart.series.map((s) => (chart.series.length > 1 ? s.label : "Value"))]}
            rows={chart.rows.map((row) => [
              row.whenLabel ?? formatReportDate(row.date),
              ...chart.series.map((s) => (row[s.key] != null ? `${row[s.key]} ${chart.unit}`.trim() : "—")),
            ])}
          />
        </div>
        );
      })}
    </section>
  );
}

export function ExerciseWeeklyVolumeSection({
  points,
  emptyMessage,
}: {
  points: ExerciseTrendPoint[];
  emptyMessage?: string;
}) {
  if (points.length === 0) {
    return emptyMessage ? <p className="text-sm text-[var(--color-text-muted)]">{emptyMessage}</p> : null;
  }
  return (
    <section className="space-y-2">
      <SectionHeader title="Weekly volume" />
      <div className="print:hidden">
        <TrendLineChart
          data={points.map((p) => ({ date: formatReportDate(p.weekStart), value: p.totalMinutes }))}
          series={[{ key: "value", label: "Minutes" }]}
          valueFormatter={(v) => `${v} min`}
          height={180}
        />
      </div>
      <ReportTable
        columns={["Week of", "Sessions", "Total minutes"]}
        rows={points.map((p) => [formatReportDate(p.weekStart), p.sessionCount, p.totalMinutes])}
      />
    </section>
  );
}

export function ExerciseByActivitySection({ byActivity }: { byActivity: ExerciseByActivityEntry[] }) {
  if (byActivity.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeader title="By activity" />
      <div className="print:hidden">
        <CategoryBarChart
          data={byActivity.map((a) => ({ label: a.activity, count: a.totalMinutes }))}
          series={[{ key: "count", label: "Minutes" }]}
          height={Math.max(120, byActivity.length * 36)}
        />
      </div>
      <ReportTable
        columns={["Activity", "Sessions", "Total minutes"]}
        rows={byActivity.map((a) => [a.activity, a.sessionCount, a.totalMinutes])}
      />
    </section>
  );
}

export function PainByRegionSection({
  byRegion,
  emptyMessage,
}: {
  byRegion: PainByRegionEntry[];
  emptyMessage?: string;
}) {
  if (byRegion.length === 0) {
    return emptyMessage ? <p className="text-sm text-[var(--color-text-muted)]">{emptyMessage}</p> : null;
  }
  return (
    <section className="space-y-3">
      <SectionHeader title="By body region" />
      <p className="text-sm text-[var(--color-text-muted)] print:hidden">
        Color shows how often each region was logged in this range, not current severity.
      </p>
      <div className="print:hidden">
        <BodyPainMap
          entries={byRegion.map((r) => ({
            key: r.bodyRegion,
            region: r.bodyRegion as HealthPainBodyRegion,
            severity: Math.min(r.count, 10),
          }))}
          onChange={() => {}}
          disabled
        />
      </div>
      <ReportTable columns={["Body region", "Times logged"]} rows={byRegion.map((r) => [r.bodyRegionLabel, r.count])} />
    </section>
  );
}

export function PainSeverityTrendSection({ trend }: { trend: PainTrendEntry[] }) {
  if (trend.length === 0) return null;
  return (
    <section className="space-y-4">
      <SectionHeader title="Severity over time" />
      {trend.map((t) => (
        <div key={t.bodyRegion} className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--color-text)]">
            {t.bodyRegionLabel}
            <span className="ml-2 font-normal text-[var(--color-text-muted)]">
              ({t.points.length} check-in{t.points.length === 1 ? "" : "s"})
            </span>
          </h3>
          <div className="print:hidden">
            <TrendLineChart
              data={t.points.map((p) => ({ date: formatReportDate(p.date), value: p.severity }))}
              series={[{ key: "value", label: t.bodyRegionLabel }]}
              valueFormatter={(v) => `${v}/10`}
              height={180}
            />
          </div>
          <ReportTable
            columns={["Date", "Severity"]}
            rows={t.points.map((p) => [formatReportDate(p.date), `${p.severity}/10`])}
          />
        </div>
      ))}
    </section>
  );
}

export function NutritionCaloriesSection({
  points,
  emptyMessage,
}: {
  points: NutritionTrendPoint[];
  emptyMessage?: string;
}) {
  if (points.length === 0) {
    return emptyMessage ? <p className="text-sm text-[var(--color-text-muted)]">{emptyMessage}</p> : null;
  }
  return (
    <section className="space-y-2">
      <SectionHeader title="Daily calories" />
      <div className="print:hidden">
        <TrendLineChart
          data={points.map((p) => ({ date: formatReportDate(p.date), value: p.calories }))}
          series={[{ key: "value", label: "Calories" }]}
          valueFormatter={(v) => `${v} cal`}
          height={180}
        />
      </div>
      <ReportTable
        columns={["Date", "Calories"]}
        rows={points.map((p) => [formatReportDate(p.date), p.calories])}
      />
    </section>
  );
}

export function NutritionMacrosSection({ points }: { points: NutritionTrendPoint[] }) {
  if (points.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeader title="Daily macros" />
      <div className="print:hidden">
        <CategoryBarChart
          data={points.map((p) => ({
            label: formatReportDate(p.date),
            proteinG: p.proteinG,
            carbsG: p.carbsG,
            fatG: p.fatG,
          }))}
          series={[
            { key: "proteinG", label: "Protein (g)" },
            { key: "carbsG", label: "Carbs (g)" },
            { key: "fatG", label: "Fat (g)" },
          ]}
          orientation="vertical"
          height={220}
        />
      </div>
      <ReportTable
        columns={["Date", "Protein (g)", "Carbs (g)", "Fat (g)"]}
        rows={points.map((p) => [formatReportDate(p.date), p.proteinG, p.carbsG, p.fatG])}
      />
    </section>
  );
}
