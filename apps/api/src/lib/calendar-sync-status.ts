import type { Database } from "@whome/db";
import {
  calendarConnections,
  linkedGoogleCalendars,
} from "@whome/db";
import { parseSyncRunProgress } from "@whome/calendar-sync";
import { and, asc, eq } from "drizzle-orm";

export async function buildCalendarSyncStatus(
  db: Database,
  auth: { userId: string; householdId: string },
) {
  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, auth.userId),
        eq(calendarConnections.householdId, auth.householdId),
      ),
    )
    .limit(1);

  if (!conn) {
    return { connected: false as const };
  }

  const linked = await db
    .select({
      id: linkedGoogleCalendars.id,
      summary: linkedGoogleCalendars.summary,
      syncEnabled: linkedGoogleCalendars.syncEnabled,
      lastSyncAt: linkedGoogleCalendars.lastSyncAt,
      lastSyncError: linkedGoogleCalendars.lastSyncError,
    })
    .from(linkedGoogleCalendars)
    .where(eq(linkedGoogleCalendars.connectionId, conn.id))
    .orderBy(asc(linkedGoogleCalendars.summary));

  const progress = parseSyncRunProgress(conn.syncRunProgress);
  const active =
    conn.syncRunStatus === "queued" || conn.syncRunStatus === "syncing";

  return {
    connected: true as const,
    syncMode: conn.syncMode,
    lastSyncAt: conn.lastSyncAt,
    run: {
      status: conn.syncRunStatus,
      progress,
      error: conn.syncRunError,
      active,
    },
    linked,
  };
}

export async function markSyncQueued(db: Database, connectionId: string): Promise<void> {
  await db
    .update(calendarConnections)
    .set({
      syncRunStatus: "queued",
      syncRunProgress: null,
      syncRunError: null,
    })
    .where(eq(calendarConnections.id, connectionId));
}
