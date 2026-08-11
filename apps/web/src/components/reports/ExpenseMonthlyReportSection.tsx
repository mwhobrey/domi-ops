"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { ReportExportSheet } from "./ReportExportSheet";
import { Alert, Badge, Button, EmptyState, Input, Spinner } from "../ui";

interface ExpenseReportCategoryRow {
  category: string;
  spend: number;
  monthlyTarget: number | null;
  percentUsed: number | null;
  status: "under" | "warning" | "over" | "unbudgeted";
}

interface ExpenseReport {
  month: string;
  scope?: "household" | "personal";
  monthSpend: number;
  monthBudgeted: number;
  percentUsed: number | null;
  expenseCount: number;
  byCategory: ExpenseReportCategoryRow[];
  topCategories: { category: string; spend: number }[];
  monthlyTrend: { month: string; total: number }[];
  budgetHealth: {
    over: string[];
    nearlyFull: string[];
    under: string[];
    unbudgeted: string[];
  };
  recentBigSpends: {
    id: string;
    title: string;
    amount: number;
    category: string | null;
    expenseDate: string;
  }[];
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
      <p className="text-label text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p> : null}
    </div>
  );
}

export function ExpenseMonthlyReportSection({
  driveEnabled = true,
  initialMonth,
}: {
  driveEnabled?: boolean;
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(initialMonth ?? currentMonthValue());
  const [scope, setScope] = useState<"household" | "personal">("household");
  const [report, setReport] = useState<ExpenseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month, scope });
      const data = await apiClient.get<ExpenseReport>(`/api/core/expenses/reports?${params}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reports");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [month, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportParams = useMemo(
    () => ({ module: "expenses" as const, kind: "overview" as const, month }),
    [month],
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
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="report-month">
            Month
          </label>
          <Input
            id="report-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 self-end">
          {(["household", "personal"] as const).map((key) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={scope === key ? "primary" : "secondary"}
              onClick={() => setScope(key)}
            >
              {key === "household" ? "Household" : "Me"}
            </Button>
          ))}
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
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Spent this month" value={formatMoney(report.monthSpend)} />
            <StatCard
              label="Targets set"
              value={report.monthBudgeted > 0 ? formatMoney(report.monthBudgeted) : "—"}
            />
            <StatCard
              label="Of targets used"
              value={report.percentUsed != null ? `${report.percentUsed}%` : "—"}
            />
            <StatCard label="Expenses logged" value={report.expenseCount} />
          </div>

          {report.byCategory.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">By category</h2>
              <ul className="space-y-4">
                {report.byCategory.map((row) => (
                  <li
                    key={row.category}
                    className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
                  >
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{row.category}</span>
                      <span className="tabular-nums text-[var(--color-text-muted)]">
                        {formatMoney(row.spend)}
                        {row.monthlyTarget != null ? ` / ${formatMoney(row.monthlyTarget)}` : ""}
                      </span>
                    </div>
                    {row.status === "over" ? (
                      <Badge tone="warning" className="mt-2 text-xs">
                        Over your limit
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {report.expenseCount === 0 ? (
            <EmptyState
              title="Nothing logged this month"
              description="Add expenses on the main list to see spending here."
            />
          ) : null}
        </>
      ) : null}

      <ReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportParams={exportParams}
        reportTitle={report ? `Spending — ${formatMonthLabel(report.month)}` : "Spending report"}
        driveEnabled={driveEnabled}
      />
    </div>
  );
}
