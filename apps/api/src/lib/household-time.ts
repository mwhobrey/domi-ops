import { todayIsoDateInTz } from "@domi-ops/calendar-sync";
import { households } from "@domi-ops/db";
import type { Database } from "@domi-ops/db";
import { eq } from "drizzle-orm";

export async function householdTimezone(db: Database, householdId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  return row?.timezone?.trim() || "UTC";
}

/** "Today" as the household sees it — the server clock runs in UTC. */
export async function householdTodayIsoDate(db: Database, householdId: string): Promise<string> {
  return todayIsoDateInTz(await householdTimezone(db, householdId));
}

/** Current `YYYY-MM` in the household's timezone. */
export async function householdMonthKey(db: Database, householdId: string): Promise<string> {
  return (await householdTodayIsoDate(db, householdId)).slice(0, 7);
}
