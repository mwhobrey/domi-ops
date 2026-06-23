"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { defaultDateRange } from "./ChoresCompletionReportSection";
import { ReportExportSheet } from "./ReportExportSheet";
import { Alert, Button, Input, Spinner } from "../ui";

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

export function ShoppingTripReportSection({ driveEnabled = true }: { driveEnabled?: boolean }) {
  const initial = defaultDateRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ShoppingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

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

  const exportParams = useMemo(
    () => ({ module: "shopping" as const, kind: "overview" as const, from, to }),
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
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="shop-from">
            From
          </label>
          <Input id="shop-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="shop-to">
            To
          </label>
          <Input id="shop-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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

          {report.tripCount === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No cleared shopping trips in this range.</p>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <ReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportParams={exportParams}
        reportTitle={report ? `Shopping — ${report.from} to ${report.to}` : "Shopping report"}
        driveEnabled={driveEnabled}
      />
    </div>
  );
}
