import { monFriWeekRange, type MonFriWeekRange } from "@domi-ops/calendar-sync";
import { households } from "@domi-ops/db";
import type { Database } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import type { WeeklyReportGroup, WeeklyReportItem } from "./types.js";

export async function householdTimezone(db: Database, householdId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  return row?.timezone?.trim() || "UTC";
}

export async function resolveMonFriWeek(
  db: Database,
  householdId: string,
  weekStart?: string | null,
): Promise<MonFriWeekRange & { timezone: string }> {
  const timeZone = await householdTimezone(db, householdId);
  const range = monFriWeekRange({ timeZone, weekStart });
  return { ...range, timezone: timeZone };
}

export function dueDateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function weekdayLongLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function sortItemsByDue<T extends { dueDate: string | null; title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = a.dueDate ?? "9999-12-31";
    const db = b.dueDate ?? "9999-12-31";
    if (da !== db) return da.localeCompare(db);
    return a.title.localeCompare(b.title);
  });
}

export function sortGroups<T extends { label: string; items: { dueDate: string | null; title: string }[] }>(
  groups: T[],
): T[] {
  return groups
    .map((g) => ({ ...g, items: sortItemsByDue(g.items) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export function groupItemsByDay(
  items: WeeklyReportItem[],
  weekStart: string,
  weekEnd: string,
): WeeklyReportGroup[] {
  const map = new Map<string, WeeklyReportItem[]>();
  for (const item of items) {
    if (!item.dueDate) continue;
    if (item.dueDate < weekStart || item.dueDate > weekEnd) continue;
    const list = map.get(item.dueDate) ?? [];
    list.push(item);
    map.set(item.dueDate, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayItems]) => ({
      key: date,
      label: weekdayLongLabel(date),
      items: sortItemsByDue(dayItems),
    }));
}

export function countReportItems(groups: WeeklyReportGroup[]): number {
  let n = 0;
  for (const g of groups) {
    n += g.items.length;
    if (g.subgroups) n += countReportItems(g.subgroups);
  }
  return n;
}
