import { textColorForBackground } from "./color-contrast";
import type { CalendarEventView } from "./calendar-utils";

const DEFAULT_EVENT_BG = "#3b82f6";

export function categoryCompositeKey(calendarId: string, categoryKey: string): string {
  return `${calendarId}:${categoryKey}`;
}

export function eventColors(color: string | null): { background: string; color: string } {
  const bg = color ?? DEFAULT_EVENT_BG;
  return { background: bg, color: textColorForBackground(bg) };
}

/** Event color from native category; ignores stale per-event color when category is set. */
export function resolveEventColor(
  ev: Pick<CalendarEventView, "color" | "categoryKey" | "calendarId">,
  categoryColorByKey: Map<string, string | null>,
): string | null {
  const key = ev.categoryKey?.trim();
  if (key) {
    return categoryColorByKey.get(categoryCompositeKey(ev.calendarId, key)) ?? null;
  }
  return ev.color ?? null;
}
