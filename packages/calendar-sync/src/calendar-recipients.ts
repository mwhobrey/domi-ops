import type { Database } from "@whome/db";
import { calendarShares, calendars, householdMembers } from "@whome/db";
import { and, eq } from "drizzle-orm";

/** User ids who should receive push for an event on this calendar lane. */
export async function calendarReminderRecipientUserIds(
  db: Database,
  calendarId: string,
  householdId: string,
): Promise<string[]> {
  const [cal] = await db
    .select({
      visibility: calendars.visibility,
      ownerUserId: calendars.ownerUserId,
    })
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.householdId, householdId)))
    .limit(1);
  if (!cal) return [];

  if (cal.visibility === "household") {
    const members = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    return members.map((m) => m.userId);
  }

  const userIds = new Set<string>();
  if (cal.ownerUserId) userIds.add(cal.ownerUserId);

  const shares = await db
    .select({ granteeUserId: calendarShares.granteeUserId })
    .from(calendarShares)
    .where(eq(calendarShares.calendarId, calendarId));
  for (const s of shares) userIds.add(s.granteeUserId);

  return [...userIds];
}
