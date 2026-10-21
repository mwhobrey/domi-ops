import type { Database } from "@domi-ops/db";
import {
  calendarConnections,
  calendarSyncOutbox,
  linkedGoogleCalendars,
} from "@domi-ops/db";
import { parseSyncRunProgress } from "@domi-ops/calendar-sync";
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

  const pending = await db.select({ lastError: calendarSyncOutbox.lastError }).from(calendarSyncOutbox)
    .where(eq(calendarSyncOutbox.connectionId, conn.id));
  const pushError = pending.find(p => p.lastError)?.lastError;
  const progress = parseSyncRunProgress(conn.syncRunProgress);
  const active =
    !pushError && (conn.syncRunStatus === "queued" || conn.syncRunStatus === "syncing");

  return {
    connected: true as const,
    syncMode: conn.syncMode,
    lastSyncAt: conn.lastSyncAt,
    pendingExports: pending.length,
    run: {
      status: pushError ? "failed" : conn.syncRunStatus,
      progress,
      error: pushError ?? conn.syncRunError,
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
