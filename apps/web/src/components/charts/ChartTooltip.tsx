"use client";

/** Themed tooltip content for Recharts `<Tooltip content={...} />`. Text always wears
 * text tokens, never the series color — identity comes from the swatch beside it. */
export function ChartTooltip({
  active,
  label,
  payload,
  valueFormatter,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  valueFormatter?: (value: number | string, name?: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 text-xs shadow-[var(--shadow-elevated)]">
      {label != null ? (
        <p className="mb-1 font-medium text-[var(--color-text)]">{label}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            {entry.name ? <span>{entry.name}:</span> : null}
            <span className="font-medium text-[var(--color-text)]">
              {entry.value != null
                ? (valueFormatter?.(entry.value, entry.name) ?? entry.value)
                : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
