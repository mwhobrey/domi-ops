import type { Database } from "@whome/db";
import { calendarEvents, calendars, eventCategories } from "@whome/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { normalizeHexColor } from "./calendar-import.js";

export const DEFAULT_CATEGORY_KEY = "general";

export function slugCategoryKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return (slug || "category").slice(0, 64);
}

export function categoryCompositeKey(calendarId: string, categoryKey: string): string {
  return `${calendarId}:${categoryKey}`;
}

export async function listEventCategories(
  db: Database,
  householdId: string,
  calendarId?: string,
) {
  const where = calendarId
    ? and(eq(eventCategories.householdId, householdId), eq(eventCategories.calendarId, calendarId))
    : eq(eventCategories.householdId, householdId);
  return db
    .select()
    .from(eventCategories)
    .where(where)
    .orderBy(asc(eventCategories.sortOrder), asc(eventCategories.label));
}

export async function getDefaultCategoryKey(
  db: Database,
  calendarId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ key: eventCategories.key })
    .from(eventCategories)
    .where(and(eq(eventCategories.calendarId, calendarId), eq(eventCategories.isDefault, true)))
    .limit(1);
  return row?.key ?? null;
}

export async function ensureDefaultCategory(
  db: Database,
  householdId: string,
  calendarId: string,
  opts?: { label?: string; color?: string | null },
): Promise<{ key: string }> {
  const [existing] = await db
    .select({ id: eventCategories.id, key: eventCategories.key })
    .from(eventCategories)
    .where(and(eq(eventCategories.calendarId, calendarId), eq(eventCategories.isDefault, true)))
    .limit(1);
  if (existing) {
    if (opts?.color) {
      await db
        .update(eventCategories)
        .set({
          color: normalizeHexColor(opts.color),
          updatedAt: new Date(),
        })
        .where(eq(eventCategories.id, existing.id));
    }
    return { key: existing.key };
  }

  const [cal] = await db
    .select({ color: calendars.color })
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.householdId, householdId)))
    .limit(1);

  const color = opts?.color ?? cal?.color ?? "#3b82f6";
  await db.insert(eventCategories).values({
    householdId,
    calendarId,
    key: DEFAULT_CATEGORY_KEY,
    label: (opts?.label ?? "General").slice(0, 128),
    color: normalizeHexColor(color),
    isDefault: true,
    sortOrder: 0,
  });
  return { key: DEFAULT_CATEGORY_KEY };
}

/** Backfill default categories for calendars that predate per-calendar categories. */
export async function ensureDefaultCategoriesForHousehold(
  db: Database,
  householdId: string,
  calendarId?: string,
): Promise<void> {
  if (calendarId) {
    await ensureDefaultCategory(db, householdId, calendarId);
    return;
  }
  const rows = await db
    .select({ id: calendars.id, color: calendars.color })
    .from(calendars)
    .where(and(eq(calendars.householdId, householdId), eq(calendars.archived, false)));
  for (const cal of rows) {
    await ensureDefaultCategory(db, householdId, cal.id, { color: cal.color });
  }
}

export async function seedCategoriesFromEvents(
  db: Database,
  householdId: string,
  calendarId: string,
): Promise<number> {
  const rows = await db
    .select({
      key: calendarEvents.categoryKey,
      color: calendarEvents.color,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.householdId, householdId),
        eq(calendarEvents.calendarId, calendarId),
        sql`${calendarEvents.categoryKey} is not null`,
      ),
    );

  const seen = new Set<string>();
  let created = 0;
  for (const row of rows) {
    const key = row.key?.trim();
    if (!key || seen.has(key) || key === DEFAULT_CATEGORY_KEY) continue;
    seen.add(key);
    const [existing] = await db
      .select({ id: eventCategories.id })
      .from(eventCategories)
      .where(and(eq(eventCategories.calendarId, calendarId), eq(eventCategories.key, key)))
      .limit(1);
    if (existing) continue;
    await db.insert(eventCategories).values({
      householdId,
      calendarId,
      key,
      label: key.replace(/_/g, " "),
      color: row.color ? normalizeHexColor(row.color) : null,
      isDefault: false,
    });
    created += 1;
  }
  return created;
}

export async function categoryLabelMap(
  db: Database,
  householdId: string,
): Promise<Map<string, string>> {
  const rows = await listEventCategories(db, householdId);
  return new Map(
    rows.map((r) => [categoryCompositeKey(r.calendarId, r.key), r.label]),
  );
}

export async function categoryColorMap(
  db: Database,
  householdId: string,
): Promise<Map<string, string | null>> {
  const rows = await listEventCategories(db, householdId);
  return new Map(
    rows.map((r) => [categoryCompositeKey(r.calendarId, r.key), r.color]),
  );
}

export async function validateCategoryKeyForCalendar(
  db: Database,
  householdId: string,
  calendarId: string,
  categoryKey: string | null | undefined,
): Promise<boolean> {
  const key = categoryKey?.trim();
  if (!key) return true;
  const [row] = await db
    .select({ id: eventCategories.id })
    .from(eventCategories)
    .where(
      and(
        eq(eventCategories.householdId, householdId),
        eq(eventCategories.calendarId, calendarId),
        eq(eventCategories.key, key),
      ),
    )
    .limit(1);
  return Boolean(row);
}
