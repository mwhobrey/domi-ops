"use client";

import { TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { HealthReportExport } from "../../lib/health-report-export";
import { defaultHealthReportRange } from "../reports/HealthOverviewReportBody";
import { Alert, EmptyState, Input, Spinner } from "../ui";
import {
  ExerciseByActivitySection,
  ExerciseWeeklyVolumeSection,
  PainByRegionSection,
  PainSeverityTrendSection,
  VitalsTrendSection,
} from "./HealthTrendCharts";

/**
 * Leaner than the full Reports page — charts only, no event history, no export chrome, no
 * medication adherence (WHO-303). Same `GET /api/health/reports` data as Reports; no new endpoint.
 */
export function HealthTrendsTab() {
  const defaults = defaultHealthReportRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [report, setReport] = useState<HealthReportExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<HealthReportExport>(
        `/api/health/reports?from=${from}&to=${to}&groupBy=date`,
      );
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load trends");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasAnyData =
    (report?.vitalsTrend ?? []).length > 0 ||
    (report?.exerciseTrend?.points ?? []).length > 0 ||
    (report?.painByRegion ?? []).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">To</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {loading && !report ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}

      {report && !loading && !hasAnyData ? (
        <EmptyState
          icon={<TrendingUp className="h-8 w-8" aria-hidden />}
          title="No trends yet"
          description="Log vitals, exercise, or pain to see trends here."
        />
      ) : null}

      {report ? (
        <>
          <VitalsTrendSection vitalsTrend={report.vitalsTrend ?? []} />
          <ExerciseWeeklyVolumeSection points={report.exerciseTrend?.points ?? []} />
          <ExerciseByActivitySection byActivity={report.exerciseByActivity ?? []} />
          <PainByRegionSection byRegion={report.painByRegion ?? []} />
          <PainSeverityTrendSection trend={report.painTrend ?? []} />
        </>
      ) : null}
    </div>
  );
}
