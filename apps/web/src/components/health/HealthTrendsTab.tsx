"use client";

import { TrendingUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { HealthReportExport } from "../../lib/health-report-export";
import type { NoteShareMember } from "../NoteSharePicker";
import { defaultHealthReportRange } from "../reports/HealthOverviewReportBody";
import { Alert, Button, EmptyState, Input, Select } from "../ui";
import { ContentSkeleton } from "../ContentSkeleton";
import { MedicationTrendsSection } from "./MedicationTrendsSection";
import { TrendPresentation } from "./TrendPresentation";
import { VitalsMedicationExplorer } from "./VitalsMedicationExplorer";
import {
  ExerciseByActivitySection,
  ExerciseWeeklyVolumeSection,
  NutritionCaloriesSection,
  NutritionMacrosSection,
  PainByRegionSection,
  PainSeverityTrendSection,
  ActivityStepsSection,
  SleepSection,
} from "./HealthTrendCharts";

/**
 * Shared visual trends view for Health and Reports. Uses the existing health report endpoint.
 */
export function HealthTrendsTab({
  members,
  currentMemberId,
}: {
  members: NoteShareMember[];
  currentMemberId: string;
}) {
  const defaults = defaultHealthReportRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [memberId, setMemberId] = useState(currentMemberId || members[0]?.memberId || "");
  const [fetchedReport, setReport] = useState<HealthReportExport | null>(null);
  const requestKey = JSON.stringify([memberId, from, to]);
  const [settledKey, setSettledKey] = useState("");
  const report = settledKey === requestKey ? fetchedReport : null;
  const [pending, setLoading] = useState(true);
  const loading = pending || settledKey !== requestKey;
  const [loadError, setError] = useState<string | null>(null);
  const error = settledKey === requestKey ? loadError : null;
  const fetchGen = useRef(0);

  const load = useCallback(async () => {
    const generation = ++fetchGen.current;
    setLoading(true);
    setError(null);
    try {
      if (!memberId) throw new Error("No member selected");
      const params = new URLSearchParams({ from, to, groupBy: "date", memberId });
      const data = await apiClient.get<HealthReportExport>(`/api/health/reports?${params}`);
      if (generation !== fetchGen.current) return;
      setReport(data);
      setSettledKey(requestKey);
    } catch (err) {
      if (generation !== fetchGen.current) return;
      setError(err instanceof ApiError ? err.message : "Failed to load trends");
      setReport(null);
      setSettledKey(requestKey);
    } finally {
      if (generation === fetchGen.current) setLoading(false);
    }
  }, [from, to, memberId, requestKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => { fetchGen.current += 1; }, []);

  const hasAnyData =
    (report?.vitalsTrend ?? []).length > 0 ||
    (report?.exerciseTrend?.points ?? []).length > 0 ||
    (report?.painByRegion ?? []).length > 0 ||
    (report?.nutritionTrend?.points ?? []).length > 0 ||
    (report?.activityTrend ?? []).length > 0 ||
    (report?.sleepTrend ?? []).some((t) => t.points.length > 0) ||
    (report?.medicationAdherence ?? []).length > 0 ||
    (report?.medicationMarkers ?? []).length > 0 ||
    (report?.prnFrequency ?? []).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {members.length > 1 ? (
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-text-muted)]">Member</span>
            <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.label}
                  {m.memberId === currentMemberId ? " (me)" : ""}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">To</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {error ? <Alert variant="error">{error} <Button variant="ghost" size="sm" onClick={() => void load()}>Retry</Button></Alert> : null}

      {loading && !report ? (
        <ContentSkeleton variant="report" label="Loading trends" />
      ) : null}

      {report && !loading && !hasAnyData ? (
        <EmptyState
          icon={<TrendingUp className="h-8 w-8" aria-hidden />}
          title="No trends yet"
          description="Log medication doses, vitals, exercise, pain, or meals, or sync watch activity and sleep to see trends here."
        />
      ) : null}

      {report ? (
        <TrendPresentation.Provider value={true}>
          <VitalsMedicationExplorer report={report} />
          <MedicationTrendsSection report={report} />
          <div className="grid items-start gap-6 xl:grid-cols-2 [&>section]:min-w-0 [&>section]:rounded-[var(--radius-lg)] [&>section]:border [&>section]:border-[var(--color-border)] [&>section]:bg-[var(--color-surface)] [&>section]:p-4">
          <ActivityStepsSection trend={report.activityTrend ?? []} />
          <SleepSection trend={report.sleepTrend ?? []} />
          <ExerciseWeeklyVolumeSection points={report.exerciseTrend?.points ?? []} />
          <ExerciseByActivitySection byActivity={report.exerciseByActivity ?? []} />
          <PainByRegionSection byRegion={report.painByRegion ?? []} />
          <PainSeverityTrendSection trend={report.painTrend ?? []} />
          <NutritionCaloriesSection points={report.nutritionTrend?.points ?? []} />
          <NutritionMacrosSection points={report.nutritionTrend?.points ?? []} />
          </div>
        </TrendPresentation.Provider>
      ) : null}
    </div>
  );
}
