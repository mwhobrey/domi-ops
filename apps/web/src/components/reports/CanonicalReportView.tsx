"use client";

export type CanonicalSection = {
  key: string;
  label: string;
  stats?: { label: string; value: string }[];
  tables?: { key: string; label: string; columns: string[]; rows: (string | number | null)[][] }[];
  emptyMessage?: string;
};

export type CanonicalReportData = { title: string; sections: CanonicalSection[] };

/**
 * A canonical report (sections of stat cards and tables) on screen, the same content the export
 * produces. Used by reports that have no screen of their own.
 */
export function CanonicalReportView({ report }: { report: CanonicalReportData }) {
  return (
    <div className="report-print space-y-6">
      <h2 className="text-lg font-semibold">{report.title}</h2>
      {report.sections.map((section) => {
        const onlyTable = section.tables?.length === 1 ? section.tables[0] : null;
        return (
          <section key={section.key} className="space-y-3">
            {/* A table that carries the same title as its section would repeat it. */}
            {onlyTable && onlyTable.label === section.label ? null : (
              <h3 className="text-label text-[var(--color-text-muted)]">{section.label}</h3>
            )}
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
            {section.emptyMessage && !section.tables?.length && (section.stats?.[0]?.value ?? "0") === "0" ? (
              <p className="text-sm text-[var(--color-text-muted)]">{section.emptyMessage}</p>
            ) : null}
            {section.tables?.map((table) => (
              <div key={table.key} className="space-y-2">
                <h4 className="text-sm font-medium">{table.label}</h4>
                <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                  <table className="w-full min-w-[480px] text-left text-sm">
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
        );
      })}
    </div>
  );
}
