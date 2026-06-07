"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Input, Spinner } from "./ui";

interface ReportTrip {
  id: string;
  clearedAt: string;
  tripTotal: number | null;
  hasReceipt: boolean;
  itemCount: number;
}

interface ShoppingReport {
  from: string;
  to: string;
  totalSpend: number;
  tripCount: number;
  topItems: { item: string; count: number }[];
  monthlyTotals: { month: string; total: number }[];
  trips: ReportTrip[];
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
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

export function ShoppingReportsClient() {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ShoppingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const data = await apiClient.get<ShoppingReport>(`/api/core/shopping/reports?${params}`);
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
    <div className="space-y-6">
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
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="from-date">
            From
          </label>
          <Input id="from-date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="to-date">
            To
          </label>
          <Input id="to-date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
              <p className="text-label text-[var(--color-text-muted)]">Total spend</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(report.totalSpend)}</p>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
              <p className="text-label text-[var(--color-text-muted)]">Shopping trips</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{report.tripCount}</p>
            </div>
          </div>

          {report.monthlyTotals.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Monthly totals</h2>
              <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--color-surface-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Month</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.monthlyTotals.map((row) => (
                      <tr key={row.month} className="border-t border-[var(--color-border)]">
                        <td className="px-3 py-2">{row.month}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {report.topItems.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Most purchased items</h2>
              <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--color-surface-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Item</th>
                      <th className="px-3 py-2 text-right font-medium">Times</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topItems.map((row) => (
                      <tr key={row.item} className="border-t border-[var(--color-border)]">
                        <td className="px-3 py-2">{row.item}</td>
                        <td className="px-3 py-2 text-right">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {report.trips.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Recent trips</h2>
              <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--color-surface-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">Items</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="px-3 py-2 text-right font-medium">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.trips.map((trip) => (
                      <tr key={trip.id} className="border-t border-[var(--color-border)]">
                        <td className="px-3 py-2">
                          {new Date(trip.clearedAt).toLocaleDateString(undefined, {
                            dateStyle: "medium",
                          })}
                        </td>
                        <td className="px-3 py-2 text-right">{trip.itemCount}</td>
                        <td className="px-3 py-2 text-right">
                          {trip.tripTotal != null ? formatMoney(trip.tripTotal) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {trip.hasReceipt ? (
                            <a
                              className="text-[var(--color-accent)] underline"
                              href={`/api/core/shopping/trips/${trip.id}/receipt`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {report.tripCount === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No cleared shopping trips in this date range. Clear purchased items on the shopping list
              to build history.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
