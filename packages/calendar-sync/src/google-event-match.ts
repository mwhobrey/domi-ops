import type { Database } from "@whome/db";
import { calendarEvents } from "@whome/db";
import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { MappedEventFields } from "./mapper.js";

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Find an existing row for this Google event within the household.
 * Prefers the target lane; falls back to any lane (e.g. HomeHub import lane).
 */
export async function findExistingGoogleEvent(
  db: Database,
  householdId: string,
  googleEventId: string,
  targetCalendarId: string,
) {
  const [exact] = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.householdId, householdId),
        eq(calendarEvents.googleEventId, googleEventId),
        eq(calendarEvents.calendarId, targetCalendarId),
      ),
    )
    .limit(1);
  if (exact) return exact;

  const [crossLane] = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.householdId, householdId),
        eq(calendarEvents.googleEventId, googleEventId),
      ),
    )
    .orderBy(desc(calendarEvents.updatedAt))
    .limit(1);
  return crossLane;
}

/**
 * HomeHub import may have the same event without google_event_id populated.
 * Match start + title and attach the Google id on sync.
 */
export async function findFuzzyGoogleEventMatch(
  db: Database,
  householdId: string,
  fields: MappedEventFields,
) {
  const titleNorm = normalizeTitle(fields.title);
  if (!titleNorm) return undefined;

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.householdId, householdId),
        eq(calendarEvents.startDate, fields.startDate),
        isNull(calendarEvents.googleEventId),
        or(eq(calendarEvents.source, "google"), eq(calendarEvents.source, "local")),
      ),
    )
    .limit(20);

  for (const row of rows) {
    if (normalizeTitle(row.title) !== titleNorm) continue;
    if (fields.allDay) {
      if (row.allDay) return row;
      continue;
    }
    if (row.allDay) continue;
    const rowTime = row.startTime ? String(row.startTime).slice(0, 5) : null;
    const fieldTime = fields.startTime ? fields.startTime.slice(0, 5) : null;
    if (rowTime === fieldTime) return row;
  }
  return undefined;
}

/** Remove duplicate rows sharing the same google_event_id within a household. */
export async function dedupeHouseholdGoogleEvents(
  db: Database,
  householdId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.householdId, householdId),
        isNotNull(calendarEvents.googleEventId),
      ),
    )
    .orderBy(calendarEvents.googleEventId, desc(calendarEvents.updatedAt));

  const groups = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const gid = row.googleEventId!;
    const list = groups.get(gid) ?? [];
    list.push(row);
    groups.set(gid, list);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const [, ...extras] = group;
    for (const row of extras) {
      await db.delete(calendarEvents).where(eq(calendarEvents.id, row.id));
      removed += 1;
    }
  }
  return removed;
}
