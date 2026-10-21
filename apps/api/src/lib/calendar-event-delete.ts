import type { Database } from "@domi-ops/db";
import { calendarSyncOutbox, linkedGoogleCalendars } from "@domi-ops/db";
import { googleEventIdFromLocalId, parseOutboxPayload } from "@domi-ops/calendar-sync";
import { eq, inArray } from "drizzle-orm";
import type { CalendarEventRow, EventPolicyContext } from "./calendar-event-policy.js";

/** Called with the events locked, in the same transaction as their local deletion. */
export async function queueEventGoogleDeletions(db: Database, events: CalendarEventRow[], ctx: EventPolicyContext): Promise<string[]> {
  if (!events.length) return [];
  const ids = events.map(e => e.id);
  const pending = await db.select().from(calendarSyncOutbox).where(inArray(calendarSyncOutbox.eventId, ids));
  const deletes: (typeof calendarSyncOutbox.$inferInsert)[] = [];
  for (const event of events) {
    const link = ctx.linkedByTargetCalendar.get(event.calendarId);
    if (!link || link.connectionUserId !== ctx.userId || link.syncMode !== "bidirectional") continue;
    const [lc] = await db.select().from(linkedGoogleCalendars).where(eq(linkedGoogleCalendars.id, link.linkedCalendarId)).limit(1).for("update");
    if (!lc?.syncEnabled || lc.connectionId !== link.connectionId || lc.targetCalendarId !== event.calendarId) continue;
    // A POST may have succeeded before the first export's DB transaction was lost.
    const pendingCreate = pending.some(p => p.eventId === event.id && p.operation === "create" &&
      p.connectionId === link.connectionId && parseOutboxPayload(p.payloadJson).linkedCalendarId === lc.id);
    const googleEventId = event.googleEventId ?? (pendingCreate ? googleEventIdFromLocalId(event.id) : null);
    if (!googleEventId) continue;
    deletes.push({
      householdId: event.householdId, connectionId: link.connectionId,
      eventId: event.id, operation: "delete",
      payloadJson: JSON.stringify({ linkedCalendarId: lc.id, googleCalendarId: lc.googleCalendarId, googleEventId }),
    });
  }
  await db.delete(calendarSyncOutbox).where(inArray(calendarSyncOutbox.eventId, ids));
  if (deletes.length) await db.insert(calendarSyncOutbox).values(deletes);
  return [...new Set(deletes.map(d => d.connectionId))];
}
