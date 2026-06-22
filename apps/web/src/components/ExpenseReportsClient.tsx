"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Badge, Button, EmptyState, Input, SectionHeader, Spinner } from "./ui";
import { WeeklyReportPanel } from "./WeeklyReportPanel";

interface ExpenseReportCategoryRow {
  category: string;
  spend: number;
  monthlyTarget: number | null;
  percentUsed: number | null;
  status: "under" | "warning" | "over" | "unbudgeted";
}

interface ExpenseReport {
  month: string;
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

function categoryBarTone(status: ExpenseReportCategoryRow["status"]): string {
  if (status === "over") return "bg-[var(--color-danger)]";
  if (status === "warning") return "bg-[var(--color-warning,#f59e0b)]";
  if (status === "unbudgeted") return "bg-[var(--color-text-muted)]";
  return "bg-[var(--color-accent)]";
}

function CategoryProgress({ row }: { row: ExpenseReportCategoryRow }) {
  const width = row.percentUsed != null ? Math.min(row.percentUsed, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{row.category}</span>
        <span className="tabular-nums text-[var(--color-text-muted)]">
          {formatMoney(row.spend)}
          {row.monthlyTarget != null ? ` / ${formatMoney(row.monthlyTarget)}` : ""}
        </span>
      </div>
      {row.monthlyTarget != null ? (
        <div
          className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]"
          role="progressbar"
          aria-valuenow={row.percentUsed ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${row.category}: ${row.percentUsed ?? 0}% of target used`}
        >
          <div
            className={`h-full rounded-full transition-[width] ${categoryBarTone(row.status)}`}
            style={{ width: `${width}%` }}
          />
        </div>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">No monthly target set</p>
      )}
      {row.status === "over" ? (
        <Badge tone="warning" className="text-xs">
          Over your limit
        </Badge>
      ) : row.status === "warning" ? (
        <Badge tone="accent" className="text-xs">
          Getting close
        </Badge>
      ) : null}
    </div>
  );
}

function TrendBars({ trend }: { trend: ExpenseReport["monthlyTrend"] }) {
  const max = Math.max(...trend.map((row) => row.total), 1);
  return (
    <div className="space-y-2" role="list" aria-label="Monthly spending trend">
      {trend.map((row) => {
        const width = Math.round((row.total / max) * 100);
        return (
          <div key={row.month} role="listitem" className="grid grid-cols-[7rem_1fr_5rem] items-center gap-2 text-sm">
            <span className="text-[var(--color-text-muted)]">{formatMonthLabel(row.month)}</span>
            <div
              className="h-3 overflow-hidden rounded-full bg-[var(--color-border)]"
              role="img"
              aria-label={`${formatMonthLabel(row.month)}: ${formatMoney(row.total)}`}
            >
              <div
                className="h-full rounded-full bg-[var(--color-accent)]"
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="text-right tabular-nums">{formatMoney(row.total)}</span>
          </div>
        );
      })}
    </div>
  );
}

function BudgetHealthSummary({ report }: { report: ExpenseReport }) {
  const { budgetHealth } = report;
  const hasAny =
    budgetHealth.over.length > 0 ||
    budgetHealth.nearlyFull.length > 0 ||
    budgetHealth.under.length > 0 ||
    budgetHealth.unbudgeted.length > 0;

  if (!hasAny) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Set category targets on the expenses page to see how you&apos;re doing.
      </p>
    );
  }

  const sections: { label: string; items: string[]; tone: "warning" | "accent" | "default" }[] = [
    { label: "Over your limit", items: budgetHealth.over, tone: "warning" },
    { label: "Getting close", items: budgetHealth.nearlyFull, tone: "accent" },
    { label: "Room to spend", items: budgetHealth.under, tone: "default" },
    { label: "Spending with no target", items: budgetHealth.unbudgeted, tone: "default" },
  ];

  return (
    <ul className="space-y-2 text-sm">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <li key={section.label}>
            <span className="font-medium">{section.label}: </span>
            {section.items.map((name, index) => (
              <span key={name}>
                {index > 0 ? ", " : ""}
                <Badge tone={section.tone} className="text-xs">
                  {name}
                </Badge>
              </span>
            ))}
          </li>
        ))}
    </ul>
  );
}

export function ExpenseReportsClient() {
  const [month, setMonth] = useState(currentMonthValue());
  const [report, setReport] = useState<ExpenseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month });
      const data = await apiClient.get<ExpenseReport>(`/api/core/expenses/reports?${params}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reports");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeader title="Weekly schedule" />
        <WeeklyReportPanel module="expenses" />
      </section>

      <section className="space-y-4">
        <SectionHeader title="Monthly spending" />
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
            <StatCard label="Spent this month" value={formatMoney(report.monthSpend)} />
            <StatCard
              label="Targets set"
              value={report.monthBudgeted > 0 ? formatMoney(report.monthBudgeted) : "—"}
              hint={
                report.monthBudgeted > 0
                  ? "Sum of your category targets"
                  : "Add targets on the expenses page"
              }
            />
            <StatCard
              label="Of targets used"
              value={report.percentUsed != null ? `${report.percentUsed}%` : "—"}
            />
            <StatCard label="Expenses logged" value={report.expenseCount} />
          </div>

          <section className="space-y-2">
            <SectionHeader title="How you're doing" />
            <BudgetHealthSummary report={report} />
          </section>

          {report.byCategory.length > 0 ? (
            <section className="space-y-3">
              <SectionHeader title="By category" />
              <ul className="space-y-4">
                {report.byCategory.map((row) => (
                  <li
                    key={row.category}
                    className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
                  >
                    <CategoryProgress row={row} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2">
            <SectionHeader title="Last 6 months" />
            <TrendBars trend={report.monthlyTrend} />
          </section>

          {report.topCategories.length > 0 ? (
            <section className="space-y-2">
              <SectionHeader title="Where the money went" />
              <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--color-surface-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium" scope="col">
                        Category
                      </th>
                      <th className="px-3 py-2 text-right font-medium" scope="col">
                        Spent
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topCategories.map((row) => (
                      <tr key={row.category} className="border-t border-[var(--color-border)]">
                        <td className="px-3 py-2">{row.category}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(row.spend)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {report.recentBigSpends.length > 0 ? (
            <section className="space-y-2">
              <SectionHeader title="Biggest purchases" />
              <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--color-surface-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium" scope="col">
                        What
                      </th>
                      <th className="px-3 py-2 text-left font-medium" scope="col">
                        Date
                      </th>
                      <th className="px-3 py-2 text-right font-medium" scope="col">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.recentBigSpends.map((row) => (
                      <tr key={row.id} className="border-t border-[var(--color-border)]">
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.title}</span>
                          {row.category ? (
                            <span className="ml-2 text-[var(--color-text-muted)]">{row.category}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">{row.expenseDate}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {formatMoney(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
      </section>
    </div>
  );
}
