"use client";

import { ChevronLeft, ChevronRight, FileText, FolderOpen, HardDrive } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type {
  ReportExportDestination,
  ReportRenderFormat,
  WeeklyReportData,
  WeeklyReportModule,
} from "../lib/weekly-reports";
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
import { Alert, Button, EmptyState, IconButton, Input, Select, Sheet, Spinner } from "./ui";

function PreviewBody({
  format,
  plainText,
  html,
}: {
  format: ReportRenderFormat;
  plainText: string;
  html: string;
}) {
  if (format === "styled") {
    return (
      <div
        className="max-h-[50vh] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-4 text-sm text-gray-900"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-sm">
      {plainText}
    </pre>
  );
}

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

export function WeeklyReportExportSheet({
  open,
  onClose,
  module,
  variant,
  scope,
  reportTitle,
  weekCount,
  driveEnabled = true,
}: {
  open: boolean;
  onClose: () => void;
  module: WeeklyReportModule;
  variant: string;
  scope: WeeklyScope;
  reportTitle: string;
  weekCount: number;
  driveEnabled?: boolean;
}) {
  const [format, setFormat] = useState<ReportRenderFormat>("styled");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ plainText: string; html: string } | null>(null);

  const exportNote =
    weekCount > 1
      ? `Exports one file per week (${weekCount} files). Preview shows all weeks combined.`
      : null;

  const loadGoogleStatus = useCallback(async () => {
    try {
      const data = await apiClient.get<{ connected: boolean }>(
        "/api/core/weekly-reports/google-docs/status",
      );
      setGoogleConnected(data.connected);
    } catch {
      setGoogleConnected(false);
    }
  }, []);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiClient.post<{
        preview: { plainText: string; html: string; weekCount: number };
      }>("/api/core/weekly-reports/export", {
        module,
        variant,
        ...exportScopeBody(scope),
        format,
        destination: "preview",
      });
      setPreview({ plainText: data.preview.plainText, html: data.preview.html });
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }, [format, module, scope, variant]);

  useEffect(() => {
    if (!open) return;
    void loadGoogleStatus();
  }, [open, loadGoogleStatus]);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [open, loadPreview]);

  async function runExport(target: ReportExportDestination) {
    setExporting(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiClient.post<{
        whomeDrive?: { objects: { objectId: string; title: string; url: string }[] };
        googleDocs?: { documents: { url: string; title: string }[] };
        googleDrive?: { files: { url: string; title: string }[] };
      }>("/api/core/weekly-reports/export", {
        module,
        variant,
        ...exportScopeBody(scope),
        format,
        destination: target,
      });
      if (data.whomeDrive?.objects.length) {
        const n = data.whomeDrive.objects.length;
        setSuccess(
          n === 1
            ? `Saved to Drive: ${data.whomeDrive.objects[0]!.title}`
            : `Saved ${n} files to Drive`,
        );
      } else if (data.googleDocs?.documents.length) {
        const n = data.googleDocs.documents.length;
        setSuccess(n === 1 ? "Opened in Google Docs" : `Created ${n} Google Docs`);
        for (const doc of data.googleDocs.documents) {
          window.open(doc.url, "_blank", "noopener,noreferrer");
        }
      } else if (data.googleDrive?.files.length) {
        const n = data.googleDrive.files.length;
        setSuccess(n === 1 ? "Saved to Google Drive" : `Saved ${n} files to Google Drive`);
        window.open(data.googleDrive.files[0]!.url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Export weekly report"
      description={reportTitle}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">Format</span>
          <Select value={format} onChange={(e) => setFormat(e.target.value as ReportRenderFormat)}>
            <option value="styled">Styled tables</option>
            <option value="plain">Structured text</option>
          </Select>
        </label>

        {exportNote ? <p className="text-sm text-[var(--color-text-muted)]">{exportNote}</p> : null}

        {!googleConnected ? (
          <Alert variant="info">
            Connect Google Docs in{" "}
            <a href="/profile" className="underline">
              your profile
            </a>{" "}
            to export to Google Docs or Google Drive.
          </Alert>
        ) : null}

        {error ? <Alert variant="error">{error}</Alert> : null}
        {success ? <Alert variant="success">{success}</Alert> : null}

        <div className="space-y-2">
          <p className="text-sm font-medium">Preview</p>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : preview ? (
            <PreviewBody format={format} plainText={preview.plainText} html={preview.html} />
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No preview available.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
          <Button type="button" variant="secondary" onClick={() => void loadPreview()} disabled={loading}>
            Refresh preview
          </Button>
          {driveEnabled ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void runExport("whome-drive")}
              disabled={exporting}
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              Save to Drive
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => void runExport("google-drive")}
            disabled={exporting || !googleConnected}
          >
            <HardDrive className="h-4 w-4" aria-hidden />
            Google Drive
          </Button>
          <Button
            type="button"
            onClick={() => void runExport("google-docs")}
            disabled={exporting || !googleConnected}
          >
            <FileText className="h-4 w-4" aria-hidden />
            Google Docs
          </Button>
        </div>
      </div>
    </Sheet>
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
        className="flex flex-wrap gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-1 text-sm"
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
        <div className="flex flex-wrap items-end gap-2">
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
        <div className="flex flex-wrap items-end gap-2">
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

      <div className="flex flex-wrap items-end justify-between gap-3">
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
        <div className="space-y-4">
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
        <div className="space-y-8">
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

      <WeeklyReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        module={module}
        variant={variant}
        scope={scope}
        reportTitle={exportTitle}
        weekCount={weekCount}
        driveEnabled={driveEnabled}
      />
    </div>
  );
}
