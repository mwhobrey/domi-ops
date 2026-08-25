"use client";

import dynamic from "next/dynamic";

/**
 * recharts is ~130KB gzipped — load it only on the client, only when a chart actually
 * renders. Import these instead of the direct exports from "./index" in any report
 * section, so pages that don't use charts (e.g. Shopping) don't pull recharts into
 * their bundle just because a sibling report route under the same layout does.
 */
export const LazyCategoryBarChart = dynamic(
  () => import("./CategoryBarChart").then((m) => m.CategoryBarChart),
  { ssr: false },
);

export const LazyTrendLineChart = dynamic(
  () => import("./TrendLineChart").then((m) => m.TrendLineChart),
  { ssr: false },
);
