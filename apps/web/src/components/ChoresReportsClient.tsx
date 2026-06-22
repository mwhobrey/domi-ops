"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Input, SectionHeader, Spinner } from "./ui";
import { WeeklyReportPanel } from "./WeeklyReportPanel";

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

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
      <p className="text-label text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ChoresReportsClient() {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ChoreReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeader title="Weekly schedule" />
        <WeeklyReportPanel module="chores" />
      </section>

      <section className="space-y-4">
        <SectionHeader title="Completion history" />
      {error ? (
        <Alert variant="error">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            Retry
          </button>
        </Alert>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-2"
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
      </form>

      {loading && !report ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-text-muted)]">
          <Spinner className="h-5 w-5" />
          Loading reports…
        </div>
      ) : null}

      {report && !loading ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Completions" value={report.summary.totalCompletions} />
            <StatCard
              label="On time"
              value={report.summary.onTimeCount + report.summary.earlyCount}
            />
            <StatCard label="Redemption quests" value={report.summary.redemptionCount} />
            <StatCard
              label="Avg days late"
              value={report.summary.avgDaysLate ?? "—"}
            />
          </div>

          {report.byMember.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No completed chores in this date range. Mark chores done to build history.
            </p>
          ) : (
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
          )}

          {report.byMember.some((m) => m.redemptionCount > 0) ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">How late (redemption quests)</h2>
              <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
                    <tr>
                      <th className="px-4 py-3 font-medium" scope="col">
                        Person
                      </th>
                      <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                        Same day
                      </th>
                      <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                        1–3 days
                      </th>
                      <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                        4–7 days
                      </th>
                      <th className="px-4 py-3 font-medium tabular-nums" scope="col">
                        8+ days
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byMember
                      .filter((m) => m.totalCompletions > 0)
                      .map((m) => (
                        <tr
                          key={m.memberId}
                          className="border-b border-[var(--color-border)] last:border-0"
                        >
                          <td className="px-4 py-3 font-medium">{m.label}</td>
                          <td className="px-4 py-3 tabular-nums">{m.delayBuckets.sameDay}</td>
                          <td className="px-4 py-3 tabular-nums">{m.delayBuckets.oneToThree}</td>
                          <td className="px-4 py-3 tabular-nums">{m.delayBuckets.fourToSeven}</td>
                          <td className="px-4 py-3 tabular-nums">{m.delayBuckets.overSeven}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      </section>
    </div>
  );
}
