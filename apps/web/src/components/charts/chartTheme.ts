/**
 * Chart theme — validated categorical palette (dataviz skill reference instance,
 * see apps/web/src/app/globals.css --chart-series-*). Fixed hue order, never cycled —
 * a chart with more series than slots should fold extras into "Other" or facet,
 * not generate a new hue.
 */
export const CHART_SERIES_COLORS = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
  "var(--chart-series-5)",
  "var(--chart-series-6)",
  "var(--chart-series-7)",
  "var(--chart-series-8)",
] as const;

/** All-pairs safe (scatter/small-multiples territory) — see palette.md. Prefer this cap
 * when every series must be mutually distinguishable, not just neighbor-to-neighbor. */
export const CHART_SERIES_COLORS_ALL_PAIRS_SAFE = CHART_SERIES_COLORS.slice(0, 3);

export const CHART_SEQUENTIAL_COLOR = "var(--chart-sequential)";

export const CHART_GRID_COLOR = "var(--chart-grid)";
export const CHART_AXIS_COLOR = "var(--chart-axis)";
export const CHART_SURFACE_COLOR = "var(--color-surface-elevated)";
export const CHART_TEXT_COLOR = "var(--color-text)";
export const CHART_TEXT_MUTED_COLOR = "var(--color-text-muted)";

export function seriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
}

export const CHART_AXIS_TICK_STYLE = { fill: CHART_AXIS_COLOR, fontSize: 12 };
export const CHART_LEGEND_TEXT_STYLE = { color: CHART_TEXT_MUTED_COLOR, fontSize: 12 };
