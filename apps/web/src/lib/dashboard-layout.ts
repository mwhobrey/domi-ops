export const DASHBOARD_CARD_IDS = [
  "glance",
  "agenda",
  "weather",
  "conflicts",
  "household",
  "month",
] as const;

export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

export const DASHBOARD_COLUMN_COUNTS = [1, 2, 3] as const;
export type DashboardColumnCount = (typeof DASHBOARD_COLUMN_COUNTS)[number];

export const DASHBOARD_SPANS = [1, 2, 3] as const;
export type DashboardSpan = (typeof DASHBOARD_SPANS)[number];

export type DashboardLayoutState = {
  columns: DashboardColumnCount;
  cards: DashboardCardId[];
  spans: Partial<Record<DashboardCardId, DashboardSpan>>;
};

export type DashboardLayoutSaved = {
  cards: string[] | null;
  columns?: unknown;
  spans?: unknown;
};

const KNOWN = new Set<string>(DASHBOARD_CARD_IDS);

export const DEFAULT_DASHBOARD_LAYOUT: DashboardCardId[] = [...DASHBOARD_CARD_IDS];

export const DEFAULT_DASHBOARD_COLUMNS: DashboardColumnCount = 2;

/** Cards that default to one column so they can sit side by side in a 2+ col grid. */
export const HALF_SPAN_CARD_IDS = new Set<DashboardCardId>(["agenda", "weather"]);

export const DASHBOARD_CARD_LABELS: Record<DashboardCardId, string> = {
  glance: "Today at a glance",
  agenda: "Today's schedule",
  weather: "Weather",
  conflicts: "Schedule conflict checker",
  household: "Household",
  month: "Month calendar",
};

export const DASHBOARD_GRID_GAP_PX = 24;

export function isDashboardCardId(value: string): value is DashboardCardId {
  return KNOWN.has(value);
}

export function isDashboardColumnCount(value: unknown): value is DashboardColumnCount {
  return value === 1 || value === 2 || value === 3;
}

export function isDashboardSpan(value: unknown): value is DashboardSpan {
  return value === 1 || value === 2 || value === 3;
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

export function parseDashboardSpans(raw: unknown): Partial<Record<DashboardCardId, DashboardSpan>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<DashboardCardId, DashboardSpan>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDashboardCardId(key) || !isDashboardSpan(value)) continue;
    out[key] = value;
  }
  return out;
}

export function hydrateDashboardLayout(saved: DashboardLayoutSaved | string[] | null): DashboardLayoutState {
  if (Array.isArray(saved)) {
    return {
      columns: DEFAULT_DASHBOARD_COLUMNS,
      cards: saved.length === 0 ? [...DEFAULT_DASHBOARD_LAYOUT] : mergeDashboardLayout(saved),
      spans: {},
    };
  }
  if (!saved || !saved.cards || saved.cards.length === 0) {
    return {
      columns: isDashboardColumnCount(saved?.columns) ? saved.columns : DEFAULT_DASHBOARD_COLUMNS,
      cards: [...DEFAULT_DASHBOARD_LAYOUT],
      spans: parseDashboardSpans(saved?.spans),
    };
  }
  return {
    columns: isDashboardColumnCount(saved.columns) ? saved.columns : DEFAULT_DASHBOARD_COLUMNS,
    cards: mergeDashboardLayout(saved.cards),
    spans: parseDashboardSpans(saved.spans),
  };
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

export function defaultDashboardSpan(id: DashboardCardId, columns: DashboardColumnCount): DashboardSpan {
  if (HALF_SPAN_CARD_IDS.has(id)) return 1;
  return columns;
}

/** Stored span if set, otherwise agenda/weather=1 and everyone else=full row. Clamped to columns. */
export function resolveDashboardSpan(
  id: DashboardCardId,
  columns: DashboardColumnCount,
  spans: Partial<Record<DashboardCardId, DashboardSpan>>,
): DashboardSpan {
  const stored = spans[id];
  const raw = stored ?? defaultDashboardSpan(id, columns);
  return Math.min(raw, columns) as DashboardSpan;
}

export function spanFromResize(
  pointerX: number,
  itemLeft: number,
  gridWidth: number,
  columns: DashboardColumnCount,
  gapPx: number = DASHBOARD_GRID_GAP_PX,
): DashboardSpan {
  if (columns <= 1) return 1;
  const colW = (gridWidth - gapPx * (columns - 1)) / columns;
  const span = Math.round((pointerX - itemLeft + gapPx) / (colW + gapPx));
  return Math.min(columns, Math.max(1, span)) as DashboardSpan;
}
