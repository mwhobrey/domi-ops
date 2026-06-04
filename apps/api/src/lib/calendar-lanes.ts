import type { Database } from "@whome/db";
import { calendarShares, calendars } from "@whome/db";
import { and, eq } from "drizzle-orm";

export type CalendarRow = typeof calendars.$inferSelect;

/** Calendars the member may see (household lanes + own private + shared). */
export async function listVisibleCalendars(
  db: Database,
  householdId: string,
  userId: string,
): Promise<CalendarRow[]> {
  const sharedIds = await db
    .select({ calendarId: calendarShares.calendarId })
    .from(calendarShares)
    .where(eq(calendarShares.granteeUserId, userId));
  const sharedSet = new Set(sharedIds.map((r) => r.calendarId));

  const rows = await db
    .select()
    .from(calendars)
    .where(eq(calendars.householdId, householdId));

  return rows.filter((c) => {
    if (c.archived) return false;
    if (c.visibility === "household") return true;
    if (c.ownerUserId === userId) return true;
    return sharedSet.has(c.id);
  });
}

export async function canAccessCalendar(
  db: Database,
  calendarId: string,
  householdId: string,
  userId: string,
): Promise<boolean> {
  const visible = await listVisibleCalendars(db, householdId, userId);
  return visible.some((c) => c.id === calendarId);
}

export async function canWriteCalendar(
  db: Database,
  calendarId: string,
  householdId: string,
  userId: string,
): Promise<boolean> {
  const [cal] = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.householdId, householdId)))
    .limit(1);
  if (!cal || cal.archived) return false;
  if (cal.visibility === "household") return true;
  if (cal.ownerUserId === userId) return true;
  const [share] = await db
    .select({ canWrite: calendarShares.canWrite })
    .from(calendarShares)
    .where(
      and(
        eq(calendarShares.calendarId, calendarId),
        eq(calendarShares.granteeUserId, userId),
      ),
    )
    .limit(1);
  return Boolean(share?.canWrite);
}

export async function setHouseholdDefaultCalendar(
  db: Database,
  householdId: string,
  calendarId: string,
): Promise<void> {
  await db
    .update(calendars)
    .set({ isHouseholdDefault: false, updatedAt: new Date() })
    .where(eq(calendars.householdId, householdId));
  await db
    .update(calendars)
    .set({ isHouseholdDefault: true, updatedAt: new Date() })
    .where(and(eq(calendars.id, calendarId), eq(calendars.householdId, householdId)));
}
