"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { ReportExportSheet } from "./ReportExportSheet";
import { Alert, Button, Input, Spinner } from "../ui";
import { LazyCategoryBarChart as CategoryBarChart } from "../charts/lazy";

interface ChoreMemberReport {
  memberId: string;
  label: string;
  totalCompletions: number;
  onTimeCount: number;
  earlyCount: number;
  redemptionCount: number;
  noDueCount: number;
  avgDaysLate: number | null;
  karmaEarned: number;
  delayBuckets: {
    sameDay: number;
    oneToThree: number;
    fourToSeven: number;
    overSeven: number;
  };
}

interface ChoreReport {
  from: string;
  to: string;
  summary: {
    totalCompletions: number;
    onTimeCount: number;
    earlyCount: number;
    redemptionCount: number;
    noDueCount: number;
    avgDaysLate: number | null;
  };
  byMember: ChoreMemberReport[];
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
      <p className="text-label text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function defaultDateRange(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function ChoresCompletionReportSection({ driveEnabled = true }: { driveEnabled?: boolean }) {
  const initial = defaultDateRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ChoreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const data = await apiClient.get<ChoreReport>(`/api/core/chores/reports?${params}`);
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
    () => ({ module: "chores" as const, kind: "overview" as const, from, to }),
    [from, to],
  );

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="error">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            Retry
          </button>
        </Alert>
      ) : null}

      <form
        className="no-print flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="chores-from">
            From
          </label>
          <Input id="chores-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="chores-to">
            To
          </label>
          <Input id="chores-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="submit" loading={loading}>
          Update
        </Button>
        {report ? (
          <Button type="button" size="sm" onClick={() => setExportOpen(true)}>
            Export…
          </Button>
        ) : null}
      </form>

      {loading && !report ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-text-muted)]">
          <Spinner className="h-5 w-5" />
          Loading reports…
        </div>
      ) : null}

      {report && !loading ? (
        <div className="report-print space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Completions" value={report.summary.totalCompletions} />
            <StatCard
              label="On time"
              value={report.summary.onTimeCount + report.summary.earlyCount}
            />
            <StatCard label="Redemption quests" value={report.summary.redemptionCount} />
            <StatCard label="Avg days late" value={report.summary.avgDaysLate ?? "—"} />
          </div>

          {report.byMember.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No completed chores in this date range.
            </p>
          ) : (
            <>
            <div className="print:hidden">
              <CategoryBarChart
                data={report.byMember.map((m) => ({ label: m.label, completions: m.totalCompletions }))}
                series={[{ key: "completions", label: "Completions" }]}
                height={Math.max(120, report.byMember.length * 36)}
              />
            </div>
            <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
                  <tr>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Person
                    </th>
                    <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                      Done
                    </th>
                    <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                      On time
                    </th>
                    <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                      Early
                    </th>
                    <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                      Redemption
                    </th>
                    <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                      Avg late (days)
                    </th>
                    <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                      Karma
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.byMember.map((m) => (
                    <tr key={m.memberId} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-3 font-medium">{m.label}</td>
                      <td className="px-4 py-3 tabular-nums">{m.totalCompletions}</td>
                      <td className="px-4 py-3 tabular-nums">{m.onTimeCount}</td>
                      <td className="px-4 py-3 tabular-nums">{m.earlyCount}</td>
                      <td className="px-4 py-3 tabular-nums">{m.redemptionCount}</td>
                      <td className="px-4 py-3 tabular-nums">{m.avgDaysLate ?? "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{m.karmaEarned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      ) : null}

      <ReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportParams={exportParams}
        reportTitle={report ? `Chore completion — ${report.from} to ${report.to}` : "Chore report"}
        driveEnabled={driveEnabled}
      />
    </div>
  );
}
