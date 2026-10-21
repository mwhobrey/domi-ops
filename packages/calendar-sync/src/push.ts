import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { calendarConnections, calendarEvents, calendarSyncOutbox, linkedGoogleCalendars } from "@domi-ops/db";
import { and, asc, eq } from "drizzle-orm";
import { CalendarCredentialsError, ensureAccessToken } from "./client.js";
import { listReminderOffsetsForEvent } from "./event-reminders.js";
import { eventTimeRangeError } from "./event-time.js";
import { eventToGoogleBody } from "./mapper.js";

export class CalendarPushError extends Error {}
class GoogleCalendarRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function googleCalendarMutate(token: string, method: "PUT" | "POST" | "DELETE", path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    let reason = "";
    try {
      const response = await res.json() as { error?: { errors?: { reason?: string }[] } };
      reason = response.error?.errors?.[0]?.reason ?? "";
    } catch { /* An upstream proxy may return HTML. */ }
    throw new GoogleCalendarRequestError(res.status, reason === "timeRangeEmpty"
      ? "Google rejected the event times. Set the end after the start, with the next end date for overnight events."
      : res.status === 401 || res.status === 403
        ? "Google Calendar access was denied. Check calendar write access or reconnect Google."
        : `Google Calendar returned HTTP ${res.status}. Try syncing again.`);
  }
  return res.status === 204 ? {} : await res.json() as Record<string, unknown>;
}

function pushError(error: unknown): CalendarPushError {
  if (error instanceof CalendarPushError) return error;
  return new CalendarPushError(error instanceof GoogleCalendarRequestError ? error.message
    : error instanceof CalendarCredentialsError ? "Google Calendar access expired or is unavailable. Reconnect Google in Calendar settings."
      : "Could not reach Google Calendar. Try syncing again.");
}

/** UUID hex is a valid Google base32hex ID; retries address the same event. */
export function googleEventIdFromLocalId(eventId: string): string {
  return eventId.replace(/-/g, "").toLowerCase();
}

async function pushEvent(db: Database, env: Env, eventId: string, linkedCalendarId: string, operation: "create" | "update"): Promise<boolean> {
  const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).limit(1).for("update");
  if (!ev || (operation === "update" && !ev.googleEventId)) return false;
  if (operation === "create" && ev.googleEventId) {
    if (ev.syncStatus === "synced") return false;
    operation = "update";
  }
  const [lc] = await db.select().from(linkedGoogleCalendars).where(eq(linkedGoogleCalendars.id, linkedCalendarId)).limit(1).for("update");
  if (!lc?.syncEnabled || lc.targetCalendarId !== ev.calendarId) return false;
  const [conn] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, lc.connectionId)).limit(1);
  if (!conn || conn.householdId !== ev.householdId || conn.syncMode !== "bidirectional") return false;
  let updated: Record<string, unknown>;
  const googleId = ev.googleEventId ?? googleEventIdFromLocalId(ev.id);
  const path = `/calendars/${encodeURIComponent(lc.googleCalendarId)}/events`;
  try {
    const rangeError = eventTimeRangeError(ev);
    if (rangeError) throw new CalendarPushError(rangeError);
    const reminderOffsets = await listReminderOffsetsForEvent(db, ev.id);
    const body = eventToGoogleBody({ ...ev, reminderOffsets }, conn.timeZone ?? "UTC");
    const token = await ensureAccessToken(db, env, conn);
    if (operation === "update") {
      updated = await googleCalendarMutate(token, "PUT", `${path}/${encodeURIComponent(googleId)}`, body);
    } else {
      try { updated = await googleCalendarMutate(token, "POST", path, { ...body, id: googleId }); }
      catch (error) {
        if (!(error instanceof GoogleCalendarRequestError) || error.status !== 409) throw error;
        // The previous POST may have succeeded before its local transaction was lost.
        updated = await googleCalendarMutate(token, "PUT", `${path}/${encodeURIComponent(googleId)}`, body);
      }
    }
  } catch (error) {
    const failure = pushError(error);
    await db.update(calendarEvents).set({ syncStatus: "error", updatedAt: new Date() }).where(eq(calendarEvents.id, ev.id));
    throw failure;
  }
  await db.update(calendarEvents).set({
    googleEventId: updated.id ? String(updated.id) : googleId,
    googleEtag: updated.etag ? String(updated.etag) : ev.googleEtag,
    syncStatus: "synced", updatedAt: new Date(),
  }).where(eq(calendarEvents.id, ev.id));
  return true;
}
export const pushEventCreate = (db: Database, env: Env, eventId: string, linkedCalendarId: string) => pushEvent(db, env, eventId, linkedCalendarId, "create");
export const pushEventUpdate = (db: Database, env: Env, eventId: string, linkedCalendarId: string) => pushEvent(db, env, eventId, linkedCalendarId, "update");

export type DeletePayload = { linkedCalendarId: string; googleCalendarId: string; googleEventId: string };
export function parseOutboxPayload(raw: string | null): Partial<DeletePayload> {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object") return {};
    const result: Partial<DeletePayload> = {};
    for (const key of ["linkedCalendarId", "googleCalendarId", "googleEventId"] as const) {
      const field = (value as Record<string, unknown>)[key];
      if (typeof field === "string" && field.length > 0 && field.length <= 256) result[key] = field;
    }
    return result;
  } catch { return {}; }
}

export async function pushEventDelete(db: Database, env: Env, row: typeof calendarSyncOutbox.$inferSelect): Promise<boolean> {
  const payload = parseOutboxPayload(row.payloadJson);
  if (!payload.linkedCalendarId || !payload.googleCalendarId || !payload.googleEventId) throw new CalendarPushError("The queued Google deletion has no valid destination.");
  const [lc] = await db.select().from(linkedGoogleCalendars).where(eq(linkedGoogleCalendars.id, payload.linkedCalendarId)).limit(1).for("update");
  if (!lc || lc.connectionId !== row.connectionId || lc.googleCalendarId !== payload.googleCalendarId) throw new CalendarPushError("The Google calendar mapping changed. The queued deletion was not sent.");
  const [conn] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, row.connectionId)).limit(1);
  if (!conn || conn.householdId !== row.householdId || conn.syncMode !== "bidirectional" || !lc.syncEnabled) throw new CalendarPushError("Enable bidirectional sync for this calendar to finish its queued deletion.");
  try {
    const token = await ensureAccessToken(db, env, conn);
    await googleCalendarMutate(token, "DELETE", `/calendars/${encodeURIComponent(payload.googleCalendarId)}/events/${encodeURIComponent(payload.googleEventId)}`);
  } catch (error) {
    if (!(error instanceof GoogleCalendarRequestError) || ![404, 410].includes(error.status)) throw pushError(error);
  }
  return true;
}

export type OutboxResult = { failed: number; error: string | null };
export async function processOutboxForConnection(db: Database, env: Env, connectionId: string, limit = 50): Promise<OutboxResult> {
  const rows = await db.select().from(calendarSyncOutbox).where(eq(calendarSyncOutbox.connectionId, connectionId)).orderBy(asc(calendarSyncOutbox.createdAt)).limit(limit);
  const linked = await db.select().from(linkedGoogleCalendars).where(eq(linkedGoogleCalendars.connectionId, connectionId));
  const result: OutboxResult = { failed: 0, error: null };
  for (const row of rows) {
    if (row.connectionId !== connectionId) continue;
    const payload = parseOutboxPayload(row.payloadJson);
    const lcId = payload.linkedCalendarId;
    const destination = linked.find(l => l.id === lcId && l.connectionId === connectionId);
    try {
      if (row.operation === "delete") {
        await pushEventDelete(db, env, row);
      } else {
        if (!row.eventId || !destination?.syncEnabled) {
          await db.delete(calendarSyncOutbox).where(eq(calendarSyncOutbox.id, row.id));
          continue;
        }
        const [ev] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, row.eventId)).limit(1).for("update");
        if (!ev || destination.targetCalendarId !== ev.calendarId) {
          await db.delete(calendarSyncOutbox).where(eq(calendarSyncOutbox.id, row.id));
          continue;
        }
        const ok = row.operation === "create" ? await pushEventCreate(db, env, row.eventId, lcId!)
          : row.operation === "update" ? await pushEventUpdate(db, env, row.eventId, lcId!) : false;
        if (!ok && ev.syncStatus !== "synced") throw new CalendarPushError("Event export is pending. Check the linked calendar and sync mode.");
      }
      await db.delete(calendarSyncOutbox).where(and(eq(calendarSyncOutbox.id, row.id), eq(calendarSyncOutbox.connectionId, connectionId)));
    } catch (error) {
      if (!(error instanceof CalendarPushError)) throw error;
      result.failed += 1;
      result.error ??= error.message;
      await db.update(calendarSyncOutbox).set({ attempts: row.attempts + 1, lastError: error.message }).where(eq(calendarSyncOutbox.id, row.id));
    }
  }
  return result;
}
