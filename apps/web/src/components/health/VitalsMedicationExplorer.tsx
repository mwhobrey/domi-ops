"use client";

import { useState } from "react";
import type { HealthReportExport } from "../../lib/health-report-export";
import { buildVitalsCharts } from "../../lib/vitals-trend-charts";
import { doseDaySummary, timelineDays, timelineReadingRows } from "../../lib/medication-vitals-timeline";
import { MARKER_VERB } from "../../lib/vitals-medication-overlay";
import { todayIsoInTimeZone } from "../../lib/household-date";
import { MedicationComparison } from "./HealthTrendCharts";
import { LazyTrendLineChart } from "../charts/lazy";
import { Button, Card, CardBody, Checkbox, SectionHeader, Select } from "../ui";
import { formatReportDate, ReportTable } from "../reports/HealthOverviewReportBody";

export function VitalsMedicationExplorer({ report }: { report: HealthReportExport }) {
  const charts = buildVitalsCharts(report.vitalsTrend ?? []);
  const [chartKey, setChartKey] = useState("");
  const chart = charts.find((c) => c.key === chartKey) ?? charts[0];
  const [selectedDay, setSelectedDay] = useState("");
  const [hiddenMeds, setHiddenMeds] = useState<string[]>([]);
  const [windowSize, setWindowSize] = useState(7);
  const [windowEnd, setWindowEnd] = useState(report.to);
  if (!chart) return null;
  const allDays = timelineDays(report.from, report.to);
  const endIndex = allDays.includes(windowEnd) ? allDays.indexOf(windowEnd) : allDays.length - 1;
  const startIndex = Math.max(0, endIndex - windowSize + 1);
  const days = allDays.slice(startIndex, endIndex + 1);
  const rows = timelineReadingRows(chart, days, report.timezone);
  const plottedRows = rows.length ? rows : days.map((date, i) => ({
    date, x: i + 0.5, whenLabel: formatReportDate(date),
    ...Object.fromEntries(chart.series.map((s) => [s.key, null])),
  }));
  const memberId = chart.memberId;
  const meds = (report.medicationDoseTrend ?? []).filter((m) => m.memberId === memberId);
  const visibleMeds = meds.filter((m) => !hiddenMeds.includes(m.medicationId));
  const markers = (report.medicationMarkers ?? []).filter((m) => m.memberId === memberId && !hiddenMeds.includes(m.medicationId));
  const day = days.includes(selectedDay) ? selectedDay : rows[rows.length - 1]?.date ?? days[days.length - 1] ?? "";
  const readings = chart.rows.filter((r) => r.date === day);
  const changes = markers.filter((m) => m.date === day);
  const logs = report.medicationLogHistory.filter((l) =>
    l.memberId === memberId &&
    !hiddenMeds.includes(l.medicationId ?? "") &&
    todayIsoInTimeZone(report.timezone, new Date(l.scheduledAt ?? l.loggedAt)) === day,
  );
  const markerDays = [...new Set(markers.filter((m) => days.includes(m.date)).map((m) => m.date))];
  const chartWidth = Math.max(280, days.length * 28);
  const pointColor = (p: typeof meds[number]["points"][number] | undefined) => {
    if (!p) return "transparent";
    if (p.missed) return "var(--color-danger)";
    if (p.skipped) return "var(--color-warning)";
    if (p.taken || p.prn) return "var(--color-success)";
    return "var(--color-text-muted)";
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <SectionHeader title="Vitals and medications" />
        <p className="text-sm text-[var(--color-text-muted)]">Compare readings with doses and medication changes on the same dates. Select a reading or a dose square to inspect that day.</p>
        <label className="block max-w-md space-y-1 text-sm">
          <span>Vital</span>
          <Select value={chart.key} onChange={(e) => setChartKey(e.target.value)}>
            {charts.map((c) => <option key={c.key} value={c.key}>{c.title} ({c.unit})</option>)}
          </Select>
        </label>
        {meds.length ? (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-2 text-xs text-[var(--color-text-muted)]">Medications to compare</legend>
            {meds.map((m) => (
              <label key={m.medicationId} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!hiddenMeds.includes(m.medicationId)}
                  onChange={(e) => setHiddenMeds((prev) => e.target.checked
                    ? prev.filter((id) => id !== m.medicationId)
                    : [...prev, m.medicationId])}
                />
                {m.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            <span>Timeline window</span>
            <Select value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </Select>
          </label>
          <Button size="sm" variant="secondary" disabled={startIndex === 0} onClick={() => setWindowEnd(allDays[Math.max(windowSize - 1, endIndex - windowSize)] ?? allDays[0]!)}>Earlier</Button>
          <Button size="sm" variant="secondary" disabled={endIndex === allDays.length - 1} onClick={() => setWindowEnd(allDays[Math.min(allDays.length - 1, endIndex + windowSize)]!)}>Later</Button>
          <span className="py-2 text-xs text-[var(--color-text-muted)]">{formatReportDate(days[0] ?? "")} – {formatReportDate(days[days.length - 1] ?? "")}</span>
        </div>
        {rows.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No readings recorded in this window.</p> : null}
        <div className="overflow-x-auto pb-2" tabIndex={0} aria-label="Vitals and medication timeline; scroll horizontally for more dates">
          <div style={{ minWidth: chartWidth }}>
            <div className="sm:ml-32">
              <LazyTrendLineChart
                data={plottedRows}
                series={chart.series}
                xKey="x"
                xDomain={[0, days.length || 1]}
                xTicks={days.map((_, i) => i + 0.5)}
                xTickFormatter={(v) => days[Math.floor(Number(v))]?.slice(5) ?? ""}
                tooltipLabelKey="whenLabel"
                valueFormatter={(v) => `${v} ${chart.unit}`}
                height={280}
                autoScaleY
                onPointSelect={(row) => { if (typeof row.date === "string") setSelectedDay(row.date); }}
                markers={markerDays.map((date) => ({ x: days.indexOf(date), label: "+/−" }))}
              />
            </div>
            <div className="space-y-2">
              {visibleMeds.map((med) => (
                <div key={med.medicationId} className="grid items-center gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <span className="pr-2 text-xs font-medium break-words">{med.name}</span>
                  <div className="grid pl-10 pr-3" style={{ gridTemplateColumns: `repeat(${days.length || 1}, minmax(0, 1fr))` }}>
                    {days.map((date) => {
                      const point = med.points.find((p) => p.date === date);
                      return (
                        <button
                          key={date}
                          type="button"
                          aria-label={`${med.name}, ${formatReportDate(date)}: ${doseDaySummary(point)}`}
                          aria-pressed={day === date}
                          title={`${formatReportDate(date)}: ${doseDaySummary(point)}`}
                          onClick={() => setSelectedDay(date)}
                          className={`mx-auto h-7 w-full max-w-7 rounded-sm border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${day === date ? "border-[var(--color-text)]" : point ? "border-transparent" : "border-[var(--color-border)]"}`}
                          style={{ background: pointColor(point) }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Green: taken · Amber: skipped · Red: missed · Gray: pending · Empty: no dose or record · +/−: medication change</p>
        <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3" aria-live="polite">
          <label className="block max-w-xs space-y-1 text-sm">
            <span className="font-medium">Inspect a day</span>
            <Select value={day} onChange={(e) => {
              setSelectedDay(e.target.value);
              if (!days.includes(e.target.value)) setWindowEnd(e.target.value);
            }}>
              {allDays.map((date) => <option key={date} value={date}>{formatReportDate(date)}</option>)}
            </Select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 text-sm">
              <h3 className="font-medium">Readings</h3>
              {readings.length ? readings.map((r, i) => (
                <p key={`${r.at}:${i}`}>
                  {r.whenLabel ?? formatReportDate(r.date)} · {chart.series.map((s) => `${s.label}: ${r[s.key] == null ? "—" : `${r[s.key]} ${chart.unit}`}`).join(" · ")}
                </p>
              )) : <p className="text-[var(--color-text-muted)]">No readings recorded this day.</p>}
            </div>
            <div className="space-y-1 text-sm">
              <h3 className="font-medium">Medication doses and changes</h3>
              {visibleMeds.map((m) => <p key={m.medicationId}>{m.name}: {doseDaySummary(m.points.find((p) => p.date === day))}</p>)}
              {changes.map((m) => <p key={`${m.medicationId}:${m.kind}`}>{MARKER_VERB[m.kind]} {m.name}</p>)}
              {!visibleMeds.length && !changes.length ? <p className="text-[var(--color-text-muted)]">No medication data for this day.</p> : null}
            </div>
          </div>
        </div>
        {logs.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer">Dose times for {formatReportDate(day)} ({logs.length})</summary>
            <ul className="mt-2 space-y-1">
              {logs.map((l) => <li key={l.id}>{l.medicationName}: {l.status} · logged {l.loggedAtLabel ?? l.loggedAt}{l.scheduledAt ? ` · scheduled ${l.scheduledAtLabel ?? l.scheduledAt}` : " · as needed"}</li>)}
            </ul>
            {report.medicationLogHistory.length >= 500 ? <p className="text-xs text-[var(--color-text-muted)]">Dose time details are limited to the most recent 500 records in this range. Daily dose counts above use the full range.</p> : null}
          </details>
        ) : null}
        <MedicationComparison chart={chart} markers={markers} />
        <p className="text-xs text-[var(--color-text-muted)]">Timing can suggest a pattern; it does not establish a cause.</p>
        <details className="text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">How to read this comparison</summary>
          <p className="mt-2">Mixed days show missed doses first, then skipped. Interval and as-needed medications show logged doses only; missing records are not treated as missed doses. Scheduled dose expectations use the recorded schedule and pauses; dose edits have no version history. Lines join recorded readings across gaps; they do not add measurements on days without readings.</p>
        </details>
        <ReportTable columns={["When", ...chart.series.map((s) => s.label)]} rows={chart.rows.map((r) => [r.whenLabel ?? formatReportDate(r.date), ...chart.series.map((s) => r[s.key] == null ? "—" : `${r[s.key]} ${chart.unit}`)])} />
      </CardBody>
    </Card>
  );
}
