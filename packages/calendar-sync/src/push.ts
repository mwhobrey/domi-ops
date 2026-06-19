import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  calendarConnections,
  calendarEvents,
  calendarSyncOutbox,
  linkedGoogleCalendars,
} from "@whome/db";
import { asc, eq } from "drizzle-orm";
import { CalendarCredentialsError, ensureAccessToken } from "./client.js";
import { listReminderOffsetsForEvent } from "./event-reminders.js";
import { eventToGoogleBody } from "./mapper.js";

async function googleCalendarMutate(
  accessToken: string,
  method: "PUT" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API ${res.status}: ${text}`);
  }
  if (res.status === 204) return {};
  return (await res.json()) as Record<string, unknown>;
}

export async function pushEventUpdate(
  db: Database,
  env: Env,
  eventId: string,
  linkedCalendarId: string,
): Promise<boolean> {
  const [ev] = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, eventId))
    .limit(1);
  if (!ev?.googleEventId) return false;

  const [lc] = await db
    .select()
    .from(linkedGoogleCalendars)
    .where(eq(linkedGoogleCalendars.id, linkedCalendarId))
    .limit(1);
  if (!lc) return false;

  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, lc.connectionId))
    .limit(1);
  if (!conn || conn.syncMode !== "bidirectional") return false;

  let accessToken: string;
  try {
    accessToken = await ensureAccessToken(db, env, conn);
  } catch (e) {
    if (e instanceof CalendarCredentialsError) return false;
    throw e;
  }

  const tz = conn.timeZone ?? "UTC";
  const reminderOffsets = await listReminderOffsetsForEvent(db, ev.id);
  const body = eventToGoogleBody({ ...ev, reminderOffsets }, tz);
  try {
    const updated = await googleCalendarMutate(
      accessToken,
      "PUT",
      `/calendars/${encodeURIComponent(lc.googleCalendarId)}/events/${encodeURIComponent(ev.googleEventId)}`,
      body,
    );
    await db
      .update(calendarEvents)
      .set({
        googleEtag: updated.etag ? String(updated.etag) : ev.googleEtag,
        syncStatus: "synced",
        updatedAt: new Date(),
      })
      .where(eq(calendarEvents.id, ev.id));
    return true;
  } catch {
    await db
      .update(calendarEvents)
      .set({ syncStatus: "pending", updatedAt: new Date() })
      .where(eq(calendarEvents.id, ev.id));
    return false;
  }
}

export async function processOutboxForConnection(
  db: Database,
  env: Env,
  connectionId: string,
  limit = 50,
): Promise<void> {
  const rows = await db
    .select()
    .from(calendarSyncOutbox)
    .orderBy(asc(calendarSyncOutbox.createdAt))
    .limit(limit * 3);

  const linked = await db
    .select({ id: linkedGoogleCalendars.id })
    .from(linkedGoogleCalendars)
    .where(eq(linkedGoogleCalendars.connectionId, connectionId));
  const linkedIds = new Set(linked.map((l) => l.id));

  let processed = 0;
  for (const row of rows) {
    if (processed >= limit) break;
    if (!row.eventId) {
      await db.delete(calendarSyncOutbox).where(eq(calendarSyncOutbox.id, row.id));
      continue;
    }
    let payload: { linkedCalendarId?: string } = {};
    try {
      payload = JSON.parse(row.payloadJson ?? "{}") as typeof payload;
    } catch {
      payload = {};
    }
    const lcId = payload.linkedCalendarId;
    if (!lcId || !linkedIds.has(lcId)) {
      await db.delete(calendarSyncOutbox).where(eq(calendarSyncOutbox.id, row.id));
      continue;
    }

    let ok = false;
    if (row.operation === "update") {
      ok = await pushEventUpdate(db, env, row.eventId, lcId);
    }

    const [ev] = await db
      .select({ syncStatus: calendarEvents.syncStatus })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, row.eventId))
      .limit(1);

    if (ok || ev?.syncStatus === "synced") {
      await db.delete(calendarSyncOutbox).where(eq(calendarSyncOutbox.id, row.id));
    } else {
      await db
        .update(calendarSyncOutbox)
        .set({
          attempts: row.attempts + 1,
          lastError: "retry",
        })
        .where(eq(calendarSyncOutbox.id, row.id));
    }
    processed += 1;
  }
}
