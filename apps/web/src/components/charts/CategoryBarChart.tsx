"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_TICK_STYLE, CHART_GRID_COLOR, CHART_LEGEND_TEXT_STYLE, seriesColor } from "./chartTheme";
import { ChartTooltip } from "./ChartTooltip";

export type BarSeries = { key: string; label: string };

/** Categorical comparison — spend by category, events by type, karma by member.
 * Horizontal bars (category names on the Y axis) by default since category labels
 * (medication names, budget categories) are usually too long for an X-axis tick. */
export function CategoryBarChart({
  data,
  series,
  xKey = "label",
  height = 240,
  orientation = "horizontal",
  valueFormatter,
}: {
  data: Array<Record<string, string | number>>;
  series: BarSeries[];
  xKey?: string;
  height?: number;
  /** "horizontal" = bars grow left-to-right, category names on the Y axis. */
  orientation?: "horizontal" | "vertical";
  valueFormatter?: (value: number | string, name?: string) => string;
}) {
  if (data.length === 0 || series.length === 0) return null;
  const isHorizontal = orientation === "horizontal";

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout={isHorizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 0, left: isHorizontal ? 8 : 0 }}
          barCategoryGap={4}
        >
          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="0"
            horizontal={!isHorizontal}
            vertical={isHorizontal}
          />
          {isHorizontal ? (
            <>
              <XAxis type="number" tick={CHART_AXIS_TICK_STYLE} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey={xKey}
                tick={CHART_AXIS_TICK_STYLE}
                axisLine={false}
                tickLine={false}
                width={110}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={xKey}
                type="category"
                tick={CHART_AXIS_TICK_STYLE}
                axisLine={{ stroke: CHART_GRID_COLOR }}
                tickLine={false}
              />
              <YAxis type="number" tick={CHART_AXIS_TICK_STYLE} axisLine={false} tickLine={false} width={40} />
            </>
          )}
          <Tooltip
            content={<ChartTooltip valueFormatter={valueFormatter} />}
            cursor={{ fill: "var(--color-surface-subtle)" }}
          />
          {series.length > 1 ? (
            <Legend wrapperStyle={CHART_LEGEND_TEXT_STYLE} iconType="circle" iconSize={8} />
          ) : null}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={seriesColor(i)}
              radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
