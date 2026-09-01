import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  calendarConnections,
  calendarEvents,
  calendarSyncOutbox,
  linkedGoogleCalendars,
} from "@domi-ops/db";
import { asc, eq } from "drizzle-orm";
import { CalendarCredentialsError, ensureAccessToken } from "./client.js";
import { listReminderOffsetsForEvent } from "./event-reminders.js";
import { eventToGoogleBody } from "./mapper.js";

async function googleCalendarMutate(
  accessToken: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
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

  const tz = conn.timeZone ?? "UTC";
  const reminderOffsets = await listReminderOffsetsForEvent(db, ev.id);
  const body = eventToGoogleBody({ ...ev, reminderOffsets }, tz);
  try {
    let accessToken: string;
    try {
      accessToken = await ensureAccessToken(db, env, conn);
    } catch (e) {
      if (e instanceof CalendarCredentialsError) return false;
      throw e;
    }
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
  } catch (err) {
    // Was a bare `catch {}` — every push failure (bad token, 404'd Google event, malformed
    // body, whatever) silently became a no-op "pending" status with zero trace anywhere.
    // Confirmed live: a real push failed, the outbox row got dropped anyway (see
    // processOutboxForConnection's `ev?.syncStatus === "synced"` check below, which reads the
    // *pre-push* default value, not the outcome of this call), and nothing surfaced it.
    console.error(
      `[calendar-sync] push failed for event ${ev.id} -> linked calendar ${linkedCalendarId}:`,
      err instanceof Error ? err.message : err,
    );
    await db
      .update(calendarEvents)
      .set({ syncStatus: "pending", updatedAt: new Date() })
      .where(eq(calendarEvents.id, ev.id));
    return false;
  }
}

/**
 * Google custom event IDs must be lowercase base32hex (`0-9a-v`), 5-1024 chars, unique per
 * calendar. A UUID with its hyphens stripped is exactly 32 lowercase hex chars (`0-9a-f`, a
 * strict subset of `a-v`) — deterministic per event, so retrying a create after a partial
 * failure (Google's POST succeeded, our own DB write afterward didn't — crash, connection drop)
 * hits Google's own 409 "already exists" instead of silently creating a duplicate event.
 */
function googleEventIdFromLocalId(eventId: string): string {
  return eventId.replace(/-/g, "").toLowerCase();
}

/**
 * Push a brand-new local event to Google for the first time (WHO-252). Unlike pushEventUpdate,
 * this event has no googleEventId yet — that's the whole point — so it does a Calendar API
 * `POST` (insert) instead of a `PUT`, then stores the id/etag Google hands back so every
 * subsequent edit can go through the normal pushEventUpdate path.
 */
export async function pushEventCreate(
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
  // Already has a Google event id — this isn't a first-push case (e.g. the outbox row is stale
  // because a prior attempt already succeeded).
  if (!ev || ev.googleEventId) return false;

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

  const tz = conn.timeZone ?? "UTC";
  const reminderOffsets = await listReminderOffsetsForEvent(db, ev.id);
  const googleEventId = googleEventIdFromLocalId(ev.id);
  const body = { ...eventToGoogleBody({ ...ev, reminderOffsets }, tz), id: googleEventId };
  try {
    let accessToken: string;
    try {
      accessToken = await ensureAccessToken(db, env, conn);
    } catch (e) {
      if (e instanceof CalendarCredentialsError) return false;
      throw e;
    }

    let created: Record<string, unknown>;
    try {
      created = await googleCalendarMutate(
        accessToken,
        "POST",
        `/calendars/${encodeURIComponent(lc.googleCalendarId)}/events`,
        body,
      );
    } catch (err) {
      if (!(err instanceof Error) || !/Google Calendar API 409/.test(err.message)) throw err;
      // Google already has an event under our deterministic id — a prior attempt's POST
      // succeeded but the local DB write after it didn't. Adopt what's already there instead of
      // treating this as a fresh failure (which would just retry the POST and 409 forever).
      created = await googleCalendarMutate(
        accessToken,
        "GET",
        `/calendars/${encodeURIComponent(lc.googleCalendarId)}/events/${encodeURIComponent(googleEventId)}`,
      );
    }
    await db
      .update(calendarEvents)
      .set({
        googleEventId: created.id ? String(created.id) : googleEventId,
        googleEtag: created.etag ? String(created.etag) : null,
        syncStatus: "synced",
        updatedAt: new Date(),
      })
      .where(eq(calendarEvents.id, ev.id));
    return true;
  } catch (err) {
    console.error(
      `[calendar-sync] create-push failed for event ${ev.id} -> linked calendar ${linkedCalendarId}:`,
      err instanceof Error ? err.message : err,
    );
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

  // Unscoped by design (see below) — every connection's linked-calendar ids, not just this one's.
  const linked = await db
    .select({ id: linkedGoogleCalendars.id, connectionId: linkedGoogleCalendars.connectionId })
    .from(linkedGoogleCalendars);
  const linkedIds = new Set(
    linked.filter((l) => l.connectionId === connectionId).map((l) => l.id),
  );
  const allLinkedIds = new Set(linked.map((l) => l.id));

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
    if (!lcId || !allLinkedIds.has(lcId)) {
      // Genuinely orphaned — no linkedCalendarId at all, or it points at a linked calendar that
      // no longer exists for *any* connection. Safe to drop.
      await db.delete(calendarSyncOutbox).where(eq(calendarSyncOutbox.id, row.id));
      continue;
    }
    if (!linkedIds.has(lcId)) {
      // The row query above (`rows`) isn't scoped to this connection at all — it was pulling
      // every household's outbox rows and deleting whichever ones didn't happen to belong to
      // *this* connection, on every single connection's processing run. That silently dropped
      // other households' pending sync work continuously. This row belongs to a different,
      // still-valid connection — leave it for that connection's own run to pick up.
      continue;
    }

    let ok = false;
    if (row.operation === "update") {
      ok = await pushEventUpdate(db, env, row.eventId, lcId);
    } else if (row.operation === "create") {
      ok = await pushEventCreate(db, env, row.eventId, lcId);
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
