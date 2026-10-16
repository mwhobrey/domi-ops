"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_AXIS_TICK_STYLE, CHART_GRID_COLOR, CHART_LEGEND_TEXT_STYLE, CHART_SURFACE_COLOR, seriesColor } from "./chartTheme";
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
  tooltipLabelKey,
  markers,
  xDomain,
  xTicks,
  xTickFormatter,
  onPointSelect,
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
  /** Row field shown as the tooltip heading instead of the x value (a date with its time, say). */
  tooltipLabelKey?: string;
  /** Dashed vertical lines at an x value with a short label, for events that explain the line (a medication started). */
  markers?: Array<{ x: string | number; label: string }>;
  xDomain?: [number, number];
  xTicks?: number[];
  xTickFormatter?: (value: string | number) => string;
  onPointSelect?: (row: Record<string, string | number | null>) => void;
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
        <LineChart data={plotted} margin={{ top: markers?.length ? 22 : 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey={xKey}
            type={xDomain ? "number" : "category"}
            domain={xDomain}
            ticks={xTicks}
            allowDataOverflow={Boolean(xDomain)}
            tick={CHART_AXIS_TICK_STYLE}
            axisLine={{ stroke: CHART_GRID_COLOR }}
            tickLine={false}
            tickFormatter={
              xTickFormatter ?? (dedupeXLabels
                ? (value: string | number) => (String(value).includes("​") ? "" : String(value))
                : undefined)
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
            content={<ChartTooltip valueFormatter={valueFormatter} labelKey={tooltipLabelKey} />}
            cursor={{ stroke: CHART_GRID_COLOR }}
          />
          {series.length > 1 ? (
            <Legend wrapperStyle={CHART_LEGEND_TEXT_STYLE} iconType="circle" iconSize={8} />
          ) : null}
          {(markers ?? []).map((m) => (
            <ReferenceLine
              key={`${m.x}::${m.label}`}
              x={m.x}
              stroke={CHART_AXIS_COLOR}
              strokeDasharray="4 3"
              label={{ value: m.label, position: "top", fill: CHART_AXIS_COLOR, fontSize: 11 }}
            />
          ))}
          {series.map((s, i) => {
            const selectableDot = (props: { cx?: number; cy?: number; index?: number; payload?: Record<string, string | number | null> }) => (
              <circle
                key={props.index}
                className="recharts-line-dot cursor-pointer"
                cx={props.cx}
                cy={props.cy}
                r={5}
                fill={seriesColor(i)}
                stroke={CHART_SURFACE_COLOR}
                strokeWidth={2}
                role="button"
                tabIndex={0}
                aria-label={`${props.payload?.[tooltipLabelKey ?? xKey] ?? "Reading"}: ${s.label} ${props.payload?.[s.key] ?? ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (props.payload) onPointSelect?.(props.payload);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (props.payload) onPointSelect?.(props.payload);
                  }
                }}
              />
            );
            return (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={seriesColor(i)}
              strokeWidth={2}
              dot={onPointSelect ? selectableDot : { r: 4, fill: seriesColor(i), stroke: CHART_SURFACE_COLOR, strokeWidth: 2 }}
              activeDot={onPointSelect ? selectableDot : { r: 5, fill: seriesColor(i), stroke: CHART_SURFACE_COLOR, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
