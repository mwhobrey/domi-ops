const HIDDEN_KEY = "whome:calendar-hidden-lanes";
const DEFAULT_CALENDAR_KEY = "whome:default-calendar-id";

export type CalendarLaneMeta = {
  id: string;
  name: string;
  color: string | null;
};

/** One filter pill per distinct lane name (merges duplicate DB rows like repeated HomeHub imports). */
export type CalendarLaneGroup = {
  key: string;
  label: string;
  color: string | null;
  calendarIds: string[];
};

export function groupLanesByName(lanes: CalendarLaneMeta[]): CalendarLaneGroup[] {
  const map = new Map<string, CalendarLaneGroup>();
  for (const lane of lanes) {
    const key = lane.name.trim().toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.calendarIds.push(lane.id);
      if (!existing.color && lane.color) existing.color = lane.color;
    } else {
      map.set(key, {
        key,
        label: lane.name,
        color: lane.color,
        calendarIds: [lane.id],
      });
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const IMPORT_BUCKET_LABEL = "imported from homehub";

/** Hide filter pills for lanes with no events in the loaded range (write-target dropdown stays full). */
export function filterLaneGroupsWithEvents<T extends { calendarId: string }>(
  groups: CalendarLaneGroup[],
  events: T[],
): CalendarLaneGroup[] {
  if (events.length === 0) return [];
  const active = new Set(events.map((e) => e.calendarId));
  const withEvents = groups.filter((g) => g.calendarIds.some((id) => active.has(id)));
  return sortLaneGroupsForDisplay(withEvents);
}

export function sortLaneGroupsForDisplay(groups: CalendarLaneGroup[]): CalendarLaneGroup[] {
  return [...groups].sort((a, b) => {
    const aImport = a.key === IMPORT_BUCKET_LABEL ? 1 : 0;
    const bImport = b.key === IMPORT_BUCKET_LABEL ? 1 : 0;
    if (aImport !== bImport) return aImport - bImport;
    return a.label.localeCompare(b.label);
  });
}

export function isLaneGroupHidden(group: CalendarLaneGroup, hiddenIds: Set<string>): boolean {
  return group.calendarIds.every((id) => hiddenIds.has(id));
}

export function toggleLaneGroup(group: CalendarLaneGroup, hiddenIds: Set<string>): Set<string> {
  const next = new Set(hiddenIds);
  const allHidden = isLaneGroupHidden(group, next);
  for (const id of group.calendarIds) {
    if (allHidden) next.delete(id);
    else next.add(id);
  }
  writeHiddenLaneIds(next);
  return next;
}

export function readHiddenLaneIds(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function writeHiddenLaneIds(ids: Set<string>): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids]));
}

export function toggleHiddenLane(id: string): Set<string> {
  const next = readHiddenLaneIds();
  if (next.has(id)) next.delete(id);
  else next.add(id);
  writeHiddenLaneIds(next);
  return next;
}

export function readDefaultCalendarId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(DEFAULT_CALENDAR_KEY);
}

export function writeDefaultCalendarId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(DEFAULT_CALENDAR_KEY, id);
  else localStorage.removeItem(DEFAULT_CALENDAR_KEY);
}

export function filterEventsByLanes<T extends { calendarId: string }>(
  events: T[],
  hiddenIds: Set<string>,
): T[] {
  if (hiddenIds.size === 0) return events;
  return events.filter((e) => !hiddenIds.has(e.calendarId));
}

const HIDDEN_CATEGORIES_KEY = "whome:calendar-hidden-categories";

export type EventCategoryMeta = {
  id: string;
  calendarId: string;
  key: string;
  label: string;
  color: string | null;
};

export function eventCategoryId(calendarId: string, categoryKey: string): string {
  return `${calendarId}:${categoryKey}`;
}

export function readHiddenCategoryKeys(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(HIDDEN_CATEGORIES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function writeHiddenCategoryKeys(keys: Set<string>): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify([...keys]));
}

export function toggleHiddenCategory(key: string): Set<string> {
  const next = readHiddenCategoryKeys();
  if (next.has(key)) next.delete(key);
  else next.add(key);
  writeHiddenCategoryKeys(next);
  return next;
}

export function categoriesFromEvents(
  events: {
    calendarId: string;
    categoryKey?: string | null;
    categoryLabel?: string | null;
  }[],
): EventCategoryMeta[] {
  const map = new Map<string, EventCategoryMeta>();
  for (const ev of events) {
    const key = ev.categoryKey?.trim();
    if (!key) continue;
    const id = eventCategoryId(ev.calendarId, key);
    if (!map.has(id)) {
      map.set(id, {
        id,
        calendarId: ev.calendarId,
        key,
        label: ev.categoryLabel?.trim() || key,
        color: null,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function filterEventsByCategories<T extends { calendarId: string; categoryKey?: string | null }>(
  events: T[],
  hiddenIds: Set<string>,
): T[] {
  if (hiddenIds.size === 0) return events;
  return events.filter((e) => {
    const key = e.categoryKey?.trim();
    if (!key) return true;
    return !hiddenIds.has(eventCategoryId(e.calendarId, key));
  });
}

const HIDDEN_OVERLAYS_KEY = "whome:calendar-hidden-overlays";

export type OverlayFilterMeta = {
  id: string;
  label: string;
  color: string;
};

export const OVERLAY_FILTER_META: OverlayFilterMeta[] = [
  { id: "school", label: "School", color: "#d97706" },
  { id: "health_event", label: "Health events", color: "#e11d48" },
  { id: "health_med", label: "Medications", color: "#0d9488" },
];

export function readHiddenOverlayKinds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HIDDEN_OVERLAYS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function writeHiddenOverlayKinds(kinds: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(HIDDEN_OVERLAYS_KEY, JSON.stringify([...kinds]));
}

export function toggleHiddenOverlay(kind: string): Set<string> {
  const next = readHiddenOverlayKinds();
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  writeHiddenOverlayKinds(next);
  return next;
}

export function overlayKindsFromEvents(
  events: { overlayKind?: string | null }[],
): OverlayFilterMeta[] {
  const kinds = new Set(
    events.map((e) => e.overlayKind).filter((k): k is string => Boolean(k)),
  );
  return OVERLAY_FILTER_META.filter((m) => kinds.has(m.id));
}

export function filterEventsByOverlays<T extends { overlayKind?: string | null }>(
  events: T[],
  hiddenKinds: Set<string>,
): T[] {
  if (hiddenKinds.size === 0) return events;
  return events.filter((e) => {
    if (!e.overlayKind) return true;
    return !hiddenKinds.has(e.overlayKind);
  });
}
