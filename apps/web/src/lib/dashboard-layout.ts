export const DASHBOARD_CARD_IDS = [
  "glance",
  "agenda",
  "weather",
  "conflicts",
  "household",
  "month",
] as const;

export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

const KNOWN = new Set<string>(DASHBOARD_CARD_IDS);

export const DEFAULT_DASHBOARD_LAYOUT: DashboardCardId[] = [...DASHBOARD_CARD_IDS];

export const HALF_SPAN_CARD_IDS = new Set<DashboardCardId>(["agenda", "weather"]);

export const DASHBOARD_CARD_LABELS: Record<DashboardCardId, string> = {
  glance: "Today at a glance",
  agenda: "Today's schedule",
  weather: "Weather",
  conflicts: "Schedule conflict checker",
  household: "Household",
  month: "Month calendar",
};

export function isDashboardCardId(value: string): value is DashboardCardId {
  return KNOWN.has(value);
}

/** Drop unknown ids, keep first occurrence, append any missing known ids in default order. */
export function mergeDashboardLayout(
  saved: readonly string[],
  allKnown: readonly DashboardCardId[] = DEFAULT_DASHBOARD_LAYOUT,
): DashboardCardId[] {
  const seen = new Set<DashboardCardId>();
  const out: DashboardCardId[] = [];
  for (const id of saved) {
    if (!isDashboardCardId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of allKnown) {
    if (seen.has(id)) continue;
    out.push(id);
  }
  return out;
}

export function hydrateDashboardLayout(saved: string[] | null): DashboardCardId[] {
  if (!saved || saved.length === 0) return [...DEFAULT_DASHBOARD_LAYOUT];
  return mergeDashboardLayout(saved);
}

export function availableDashboardCards(opts: { calendarModuleEnabled: boolean }): Set<DashboardCardId> {
  const set = new Set<DashboardCardId>(DEFAULT_DASHBOARD_LAYOUT);
  if (!opts.calendarModuleEnabled) set.delete("conflicts");
  return set;
}

export function visibleDashboardLayout(
  full: readonly DashboardCardId[],
  available: ReadonlySet<DashboardCardId>,
): DashboardCardId[] {
  return full.filter((id) => available.has(id));
}

/**
 * Reorder only the currently visible cards. Module-gated cards keep their relative slots
 * in the full order so turning a module back on restores the saved position.
 */
export function applyVisibleReorder(
  full: readonly DashboardCardId[],
  nextVisible: readonly DashboardCardId[],
): DashboardCardId[] {
  const vis = [...nextVisible];
  const visSet = new Set(nextVisible);
  return full.map((id) => (visSet.has(id) ? vis.shift()! : id));
}

/** Consecutive half-span cards pair on md+. An orphan half stretches full-width. */
export function dashboardCardSpan(
  id: DashboardCardId,
  visible: readonly DashboardCardId[],
): "full" | "half" {
  if (!HALF_SPAN_CARD_IDS.has(id)) return "full";
  const i = visible.indexOf(id);
  if (i < 0) return "full";
  const prev = i > 0 ? visible[i - 1] : undefined;
  const next = visible[i + 1];
  const prevHalf = prev !== undefined && HALF_SPAN_CARD_IDS.has(prev);
  const nextHalf = next !== undefined && HALF_SPAN_CARD_IDS.has(next);
  if (prevHalf) {
    const prevPrev = i > 1 ? visible[i - 2] : undefined;
    const prevPrevHalf = prevPrev !== undefined && HALF_SPAN_CARD_IDS.has(prevPrev);
    return prevPrevHalf ? "full" : "half";
  }
  return nextHalf ? "half" : "full";
}
