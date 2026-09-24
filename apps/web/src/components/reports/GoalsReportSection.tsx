"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { Alert, Button, Spinner } from "../ui";
import { ReportExportSheet } from "./ReportExportSheet";

type CanonicalSection = {
  key: string;
  label: string;
  stats?: { label: string; value: string }[];
  tables?: { key: string; label: string; columns: string[]; rows: (string | number | null)[][] }[];
  emptyMessage?: string;
};

type CanonicalReport = { title: string; sections: CanonicalSection[] };

const EXPORT_PARAMS = { module: "goals" as const, kind: "overview" as const };

export function GoalsReportSection({ driveEnabled = true }: { driveEnabled?: boolean }) {
  const [report, setReport] = useState<CanonicalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ report: CanonicalReport }>(
        "/api/core/reports?module=goals&kind=overview",
      );
      setReport(data.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load goals report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

      <div className="no-print flex justify-end">
        {report ? (
          <Button type="button" size="sm" onClick={() => setExportOpen(true)}>
            Export…
          </Button>
        ) : null}
      </div>

      {loading && !report ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}

      {report ? (
        <div className="report-print space-y-6">
          {report.sections.map((section) => (
            <section key={section.key} className="space-y-3">
              {section.stats ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {section.stats.map((s) => (
                    <div
                      key={s.label}
                      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4"
                    >
                      <p className="text-label text-[var(--color-text-muted)]">{s.label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {section.emptyMessage && !section.tables?.length ? (
                <p className="text-sm text-[var(--color-text-muted)]">{section.emptyMessage}</p>
              ) : null}
              {section.tables?.map((table) => (
                <div key={table.key} className="space-y-2">
                  <h3 className="text-sm font-medium">{table.label}</h3>
                  <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
                        <tr>
                          {table.columns.map((c) => (
                            <th key={c} className="px-4 py-3 font-medium" scope="col">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, i) => (
                          <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                            {row.map((cell, j) => (
                              <td key={j} className="px-4 py-3">
                                {cell ?? "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : null}

      <ReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportParams={EXPORT_PARAMS}
        reportTitle="Goals report"
        driveEnabled={driveEnabled}
      />
    </div>
  );
}
