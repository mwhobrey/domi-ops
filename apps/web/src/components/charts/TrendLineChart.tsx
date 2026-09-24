"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_TICK_STYLE, CHART_GRID_COLOR, CHART_LEGEND_TEXT_STYLE, CHART_SURFACE_COLOR, seriesColor } from "./chartTheme";
import { ChartTooltip } from "./ChartTooltip";

export type TrendSeries = { key: string; label: string };

/** Time-series / magnitude-over-time line chart. Series identity via the fixed
 * categorical palette; a legend only appears once there's more than one line to
 * disambiguate (dataviz skill: a single series needs no legend box). */
export function TrendLineChart({
  data,
  series,
  xKey = "date",
  height = 240,
  valueFormatter,
  autoScaleY = false,
  dedupeXLabels = false,
}: {
  data: Array<Record<string, string | number | null>>;
  series: TrendSeries[];
  xKey?: string;
  height?: number;
  valueFormatter?: (value: number | string, name?: string) => string;
  /** Fit the Y axis to the data instead of starting at 0 (SpO₂ 97–99% is otherwise a flat line). */
  autoScaleY?: boolean;
  /** Several points can share a date; label the date once instead of on every point. */
  dedupeXLabels?: boolean;
}) {
  if (data.length === 0 || series.length === 0) return null;

  // Repeated x values get a zero-width suffix so each point keeps its own slot on the category
  // axis; the tick formatter blanks every repeat.
  const plotted = dedupeXLabels
    ? data.map((row, i) => {
        let repeats = 0;
        for (let j = i - 1; j >= 0 && data[j]![xKey] === row[xKey]; j--) repeats += 1;
        return repeats > 0 ? { ...row, [xKey]: `${row[xKey]}${"​".repeat(repeats)}` } : row;
      })
    : data;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={plotted} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={CHART_AXIS_TICK_STYLE}
            axisLine={{ stroke: CHART_GRID_COLOR }}
            tickLine={false}
            tickFormatter={
              dedupeXLabels
                ? (value: string | number) => (String(value).includes("​") ? "" : String(value))
                : undefined
            }
          />
          <YAxis
            tick={CHART_AXIS_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={autoScaleY ? ["auto", "auto"] : undefined}
          />
          <Tooltip
            content={<ChartTooltip valueFormatter={valueFormatter} />}
            cursor={{ stroke: CHART_GRID_COLOR }}
          />
          {series.length > 1 ? (
            <Legend wrapperStyle={CHART_LEGEND_TEXT_STYLE} iconType="circle" iconSize={8} />
          ) : null}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={seriesColor(i)}
              strokeWidth={2}
              dot={{ r: 4, fill: seriesColor(i), stroke: CHART_SURFACE_COLOR, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: seriesColor(i), stroke: CHART_SURFACE_COLOR, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
