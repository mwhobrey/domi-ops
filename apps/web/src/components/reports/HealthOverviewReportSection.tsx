"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { ReportExportSheet } from "./ReportExportSheet";
import { defaultHealthReportRange, HealthOverviewReportBody } from "./HealthOverviewReportBody";
import { Alert, Button, Input, Spinner } from "../ui";
import type { HealthReportExport } from "../../lib/health-report-export";

export function HealthOverviewReportSection({
  initialFrom,
  initialTo,
  driveEnabled = true,
}: {
  initialFrom?: string;
  initialTo?: string;
  driveEnabled?: boolean;
}) {
  const defaults = defaultHealthReportRange();
  const [from, setFrom] = useState(initialFrom ?? defaults.from);
  const [to, setTo] = useState(initialTo ?? defaults.to);
  const [report, setReport] = useState<HealthReportExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const data = await apiClient.get<HealthReportExport>(`/api/health/reports?${params}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reports");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportParams = useMemo(
    () => ({ module: "health" as const, kind: "overview" as const, from, to }),
    [from, to],
  );

  const exportTitle = report
    ? `Health report — ${report.from} to ${report.to}`
    : "Health report";

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">To</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
        {report ? (
          <Button type="button" size="sm" onClick={() => setExportOpen(true)}>
            Export…
          </Button>
        ) : null}
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !report ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}

      {report ? <HealthOverviewReportBody report={report} /> : null}

      <ReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportParams={exportParams}
        reportTitle={exportTitle}
        driveEnabled={driveEnabled}
      />
    </div>
  );
}

export function HealthReportsClient(props: { driveEnabled?: boolean }) {
  return <HealthOverviewReportSection driveEnabled={props.driveEnabled} />;
}
