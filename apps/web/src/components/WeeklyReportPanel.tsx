"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { WeeklyReportData, WeeklyReportModule } from "../lib/weekly-reports";
import { weeklyVariantOptions } from "../lib/weekly-reports";
import {
  addDaysIso,
  currentWeekMonday,
  defaultRangeEnd,
  exportScopeBody,
  mondayOfWeekIso,
  scopeQueryParams,
  type WeeklyScope,
  type WeeklyScopeMode,
} from "../lib/weekly-week-utils";
import { ReportExportSheet } from "./reports/ReportExportSheet";
import { Alert, Button, EmptyState, IconButton, Input, Select, Spinner } from "./ui";

function ReportGroupTable({
  group,
  dayGrouped,
}: {
  group: WeeklyReportData["groups"][number];
  dayGrouped: boolean;
}) {
  const showDue =
    !dayGrouped || group.items.some((item) => item.dueLabel?.startsWith("$"));
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{group.label}</h4>
      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--color-surface-subtle)] text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Details</th>
              {showDue ? <th className="px-3 py-2 font-medium">Due</th> : null}
            </tr>
          </thead>
          <tbody>
            {group.items.map((item) => (
              <tr key={item.id} className="border-t border-[var(--color-border)]">
                <td className="px-3 py-2">{item.title}</td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">{item.subtitle ?? "—"}</td>
                {showDue ? (
                  <td className="px-3 py-2 tabular-nums">{item.dueLabel ?? item.dueDate ?? "—"}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {group.subgroups?.map((sub) => (
        <div key={sub.key} className="ml-3 border-l-2 border-[var(--color-border)] pl-3">
          <ReportGroupTable group={sub} dayGrouped={dayGrouped} />
        </div>
      ))}
    </div>
  );
}

function ReportWeekContent({ report }: { report: WeeklyReportData }) {
  if (report.totalItems === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">Nothing scheduled this week (Mon–Fri).</p>
    );
  }
  const dayGrouped = report.variant === "by-day";
  return (
    <div className="space-y-4">
      {report.groups.map((group) => (
        <ReportGroupTable key={group.key} group={group} dayGrouped={dayGrouped} />
      ))}
    </div>
  );
}

export function WeeklyReportPanel({
  module,
  driveEnabled = true,
}: {
  module: WeeklyReportModule;
  driveEnabled?: boolean;
}) {
  const [variant, setVariant] = useState(() => weeklyVariantOptions(module, "week")[0]?.id ?? "");
  const [scopeMode, setScopeMode] = useState<WeeklyScopeMode>("week");
  const [weekStart, setWeekStart] = useState(currentWeekMonday);
  const [rangeFrom, setRangeFrom] = useState(currentWeekMonday);
  const [rangeTo, setRangeTo] = useState(() => defaultRangeEnd(currentWeekMonday()));

  const [weekReport, setWeekReport] = useState<WeeklyReportData | null>(null);
  const [rangeReports, setRangeReports] = useState<WeeklyReportData[]>([]);
  const [rangeLabel, setRangeLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const variants = useMemo(
    () => weeklyVariantOptions(module, scopeMode),
    [module, scopeMode],
  );

  const scope: WeeklyScope = useMemo(
    () =>
      scopeMode === "week"
        ? { mode: "week", weekStart }
        : { mode: "range", from: rangeFrom, to: rangeTo },
    [scopeMode, weekStart, rangeFrom, rangeTo],
  );

  const weekAnchor = weekStart;
  const isCurrentWeek = weekStart === currentWeekMonday();

  const exportTitle =
    scopeMode === "week"
      ? (weekReport?.title ?? "Weekly report")
      : rangeLabel || `${rangeFrom} – ${rangeTo}`;

  const weekCount = scopeMode === "week" ? 1 : rangeReports.length;

  const exportParams = useMemo(() => {
    const body = exportScopeBody(scope);
    return {
      module,
      kind: "weekly" as const,
      variant,
      ...body,
    };
  }, [module, variant, scope]);

  const load = useCallback(async () => {
    if (!variant) return;
    if (scopeMode === "range" && rangeFrom > rangeTo) {
      setError("End date must be on or after start date.");
      setRangeReports([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = scopeQueryParams(scope);
      params.set("module", module);
      params.set("variant", variant);
      const data = await apiClient.get<
        | { mode: "week"; report: WeeklyReportData }
        | {
            mode: "range";
            from: string;
            to: string;
            rangeLabel: string;
            weekCount: number;
            reports: WeeklyReportData[];
          }
      >(`/api/core/weekly-reports?${params}`);

      if (data.mode === "week") {
        setWeekReport(data.report);
        setRangeReports([]);
        setRangeLabel("");
      } else {
        setWeekReport(null);
        setRangeReports(data.reports);
        setRangeLabel(data.rangeLabel);
      }
    } catch (err) {
      setWeekReport(null);
      setRangeReports([]);
      setError(err instanceof ApiError ? err.message : "Failed to load weekly report");
    } finally {
      setLoading(false);
    }
  }, [module, variant, scope, scopeMode, rangeFrom, rangeTo]);

  useEffect(() => {
    if (!variants.some((v) => v.id === variant)) {
      setVariant(variants[0]?.id ?? "");
    }
  }, [variants, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  function shiftWeek(delta: number) {
    setWeekStart((prev) => addDaysIso(prev, delta * 7));
  }

  function onWeekDateChange(iso: string) {
    if (!iso) return;
    setWeekStart(mondayOfWeekIso(iso));
  }

  function goToCurrentWeek() {
    const monday = currentWeekMonday();
    setWeekStart(monday);
  }

  return (
    <div className="space-y-4">
      <div
        className="no-print flex flex-wrap gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-1 text-sm"
        role="tablist"
        aria-label="Week selection mode"
      >
        {(
          [
            { id: "week" as const, label: "Single week" },
            { id: "range" as const, label: "Date range" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={scopeMode === tab.id}
            className={`rounded-[var(--radius-md)] px-3 py-1.5 font-medium transition-colors ${
              scopeMode === tab.id
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
            onClick={() => setScopeMode(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {scopeMode === "week" ? (
        <div className="no-print flex flex-wrap items-end gap-2">
          <IconButton
            type="button"
            label="Previous week"
            onClick={() => shiftWeek(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">Week containing</span>
            <Input
              type="date"
              value={weekAnchor}
              onChange={(e) => onWeekDateChange(e.target.value)}
              aria-label="Pick a date in the week to view"
            />
          </label>
          <IconButton type="button" label="Next week" onClick={() => shiftWeek(1)}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          {!isCurrentWeek ? (
            <Button type="button" variant="ghost" size="sm" onClick={goToCurrentWeek}>
              This week
            </Button>
          ) : null}
          {weekReport ? (
            <span className="text-sm text-[var(--color-text-muted)]">
              {weekReport.weekLabel} (Mon–Fri)
            </span>
          ) : null}
        </div>
      ) : (
        <div className="no-print flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">From</span>
            <Input
              type="date"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              aria-label="Range start date"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">To</span>
            <Input
              type="date"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              aria-label="Range end date"
            />
          </label>
          {rangeLabel ? (
            <span className="text-sm text-[var(--color-text-muted)]">
              {rangeReports.length} week{rangeReports.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      )}

      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">Group by</span>
          <Select value={variant} onChange={(e) => setVariant(e.target.value)}>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </label>
        {(weekReport || rangeReports.length > 0) && !loading ? (
          <Button type="button" size="sm" onClick={() => setExportOpen(true)}>
            Export…
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="error">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            Retry
          </button>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : scopeMode === "week" && weekReport ? (
        <div className="report-print space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            {weekReport.totalItems} item{weekReport.totalItems === 1 ? "" : "s"} due Mon–Fri
          </p>
          {weekReport.totalItems === 0 ? (
            <EmptyState title="Nothing scheduled this week" description="Mon–Fri looks clear." />
          ) : (
            <ReportWeekContent report={weekReport} />
          )}
        </div>
      ) : scopeMode === "range" ? (
        <div className="report-print space-y-8">
          {rangeReports.length === 0 ? (
            <EmptyState
              title="No weeks in range"
              description="Adjust the date range to include at least one Mon–Fri week."
            />
          ) : (
            rangeReports.map((report) => (
              <section key={report.weekStart} className="space-y-3">
                <h3 className="text-base font-semibold">
                  {report.weekLabel}
                  <span className="ml-2 text-sm font-normal text-[var(--color-text-muted)]">
                    {report.totalItems} item{report.totalItems === 1 ? "" : "s"}
                  </span>
                </h3>
                <ReportWeekContent report={report} />
              </section>
            ))
          )}
        </div>
      ) : null}

      <ReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportParams={exportParams}
        reportTitle={exportTitle}
        weekCount={weekCount}
        driveEnabled={driveEnabled}
      />
    </div>
  );
}

/** @deprecated Use ReportExportSheet from ./reports/ReportExportSheet */
export { ReportExportSheet as WeeklyReportExportSheet } from "./reports/ReportExportSheet";
