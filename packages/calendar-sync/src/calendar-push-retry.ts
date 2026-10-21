import type { Database } from "@domi-ops/db";
import { calendarConnections, calendarSyncOutbox } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import { getSyncQueue } from "./queue.js";

/** The database outbox survives an API/Redis race, worker restart, or failed provider call. */
export async function fanOutCalendarPushes(db: Database, redisUrl: string): Promise<void> {
  const connections = await db.selectDistinct({ id: calendarConnections.id, householdId: calendarConnections.householdId })
    .from(calendarSyncOutbox).innerJoin(calendarConnections, and(
      eq(calendarSyncOutbox.connectionId, calendarConnections.id),
      eq(calendarSyncOutbox.householdId, calendarConnections.householdId),
    )).where(eq(calendarConnections.syncMode, "bidirectional"));
  const queue = getSyncQueue(redisUrl);
  for (const conn of connections) {
    await queue.add("google.calendar.push", { name: "google.calendar.push", payload: {
      householdId: conn.householdId, connectionId: conn.id,
    } }, { jobId: `calendar-push-${conn.id}-${Math.floor(Date.now() / 60_000)}`, removeOnComplete: 100, removeOnFail: 50 });
  }
}
