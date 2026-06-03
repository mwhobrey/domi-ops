import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  calendarConnections,
  calendarEvents,
  linkedGoogleCalendars,
} from "@whome/db";
import { and, eq } from "drizzle-orm";
import { CalendarCredentialsError, ensureAccessToken, googleCalendarFetch } from "./client.js";
import { eventToFields, syncWindow } from "./mapper.js";
import type { SyncJobPayload } from "./index.js";

export async function pullLinkedCalendar(
  db: Database,
  env: Env,
  linkedId: string,
): Promise<void> {
  const [lc] = await db
    .select()
    .from(linkedGoogleCalendars)
    .where(eq(linkedGoogleCalendars.id, linkedId))
    .limit(1);
  if (!lc || !lc.syncEnabled) return;

  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, lc.connectionId))
    .limit(1);
  if (!conn) return;

  const tz = conn.timeZone ?? "UTC";
  let accessToken: string;
  try {
    accessToken = await ensureAccessToken(db, env, conn);
  } catch (e) {
    if (e instanceof CalendarCredentialsError) {
      await db
        .update(linkedGoogleCalendars)
        .set({ lastSyncError: e.message.slice(0, 500) })
        .where(eq(linkedGoogleCalendars.id, lc.id));
      return;
    }
    throw e;
  }

  const params: Record<string, string> = {
    calendarId: lc.googleCalendarId,
    singleEvents: "true",
    maxResults: "2500",
  };
  if (lc.syncToken) {
    params.syncToken = lc.syncToken;
  } else {
    const win = syncWindow();
    params.timeMin = win.timeMin;
    params.timeMax = win.timeMax;
  }

  let resp: {
    items?: Record<string, unknown>[];
    nextSyncToken?: string;
  };
  try {
    resp = (await googleCalendarFetch(
      accessToken,
      `/calendars/${encodeURIComponent(lc.googleCalendarId)}/events`,
      params,
    )) as typeof resp;
  } catch (exc) {
    const msg = String(exc);
    if (msg.includes("410") || msg.includes("fullSyncRequired")) {
      const win = syncWindow();
      resp = (await googleCalendarFetch(
        accessToken,
        `/calendars/${encodeURIComponent(lc.googleCalendarId)}/events`,
        {
          singleEvents: "true",
          maxResults: "2500",
          timeMin: win.timeMin,
          timeMax: win.timeMax,
        },
      )) as typeof resp;
      await db
        .update(linkedGoogleCalendars)
        .set({ syncToken: null })
        .where(eq(linkedGoogleCalendars.id, lc.id));
    } else {
      await db
        .update(linkedGoogleCalendars)
        .set({ lastSyncError: msg.slice(0, 500) })
        .where(eq(linkedGoogleCalendars.id, lc.id));
      throw exc;
    }
  }

  const targetCalendarId = lc.targetCalendarId;
  if (!targetCalendarId) return;

  for (const event of resp.items ?? []) {
    if (event.status === "cancelled") {
      const gid = event.id ? String(event.id) : null;
      if (gid) {
        await db
          .delete(calendarEvents)
          .where(
            and(
              eq(calendarEvents.googleEventId, gid),
              eq(calendarEvents.calendarId, targetCalendarId),
            ),
          );
      }
      continue;
    }
    const fields = eventToFields(event, tz);
    if (!fields.googleEventId) continue;

    const [existing] = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.googleEventId, fields.googleEventId),
          eq(calendarEvents.calendarId, targetCalendarId),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.syncStatus === "pending") continue;
      await db
        .update(calendarEvents)
        .set({
          title: fields.title,
          description: fields.description,
          startDate: fields.startDate,
          endDate: fields.endDate,
          startTime: fields.startTime,
          endTime: fields.endTime,
          allDay: fields.allDay,
          timeZone: fields.timeZone,
          googleEtag: fields.googleEtag,
          categoryKey: fields.categoryKey,
          syncStatus: "synced",
          updatedAt: new Date(),
        })
        .where(eq(calendarEvents.id, existing.id));
    } else {
      await db.insert(calendarEvents).values({
        householdId: conn.householdId,
        calendarId: targetCalendarId,
        title: fields.title,
        description: fields.description,
        startDate: fields.startDate,
        endDate: fields.endDate,
        startTime: fields.startTime,
        endTime: fields.endTime,
        allDay: fields.allDay,
        timeZone: fields.timeZone,
        source: "google",
        syncStatus: "synced",
        googleEventId: fields.googleEventId,
        googleRecurringEventId: fields.googleRecurringEventId,
        googleEtag: fields.googleEtag,
        categoryKey: fields.categoryKey,
        color: fields.color,
      });
    }
  }

  await db
    .update(linkedGoogleCalendars)
    .set({
      syncToken: resp.nextSyncToken ?? lc.syncToken,
      lastSyncAt: new Date(),
      lastSyncError: null,
    })
    .where(eq(linkedGoogleCalendars.id, lc.id));

  await db
    .update(calendarConnections)
    .set({ lastSyncAt: new Date() })
    .where(eq(calendarConnections.id, conn.id));
}

export async function syncConnection(
  db: Database,
  env: Env,
  connectionId: string,
  forcePull = false,
): Promise<void> {
  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);
  if (!conn) return;
  if (conn.syncMode === "manual" && !forcePull) return;

  const linked = await db
    .select()
    .from(linkedGoogleCalendars)
    .where(eq(linkedGoogleCalendars.connectionId, connectionId));

  for (const lc of linked) {
    if (lc.syncEnabled) {
      await pullLinkedCalendar(db, env, lc.id);
    }
  }
}

export async function runCalendarSyncJob(
  db: Database,
  env: Env,
  name: string,
  payload: SyncJobPayload,
): Promise<void> {
  switch (name) {
    case "google.calendar.pull":
    case "google.calendar.full_import":
      if (payload.linkedCalendarId) {
        await pullLinkedCalendar(db, env, payload.linkedCalendarId);
      } else {
        await syncConnection(db, env, payload.connectionId, true);
      }
      break;
    case "google.calendar.push":
      // Bidirectional push: outbox processing (v1 stub logs only)
      console.warn("[calendar-sync] push/outbox not fully implemented in v1");
      break;
    case "recurring.materialize":
      // Materialize recurring rules into events (v1 stub)
      console.warn("[calendar-sync] recurring.materialize stub for", payload.householdId);
      break;
    default:
      throw new Error(`Unknown sync job: ${name}`);
  }
}
