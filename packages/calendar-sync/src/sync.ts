import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  calendarConnections,
  calendarEvents,
  eventCategories,
  linkedGoogleCalendars,
} from "@whome/db";
import { and, eq } from "drizzle-orm";
import { CalendarCredentialsError, ensureAccessToken, googleCalendarFetch } from "./client.js";
import {
  dedupeHouseholdGoogleEvents,
  findExistingGoogleEvent,
  findFuzzyGoogleEventMatch,
} from "./google-event-match.js";
import { eventToFields, syncWindow } from "./mapper.js";
import { processOutboxForConnection } from "./push.js";
import { materializeRecurringForHousehold } from "./recurring.js";
import { scanCalendarReminders } from "./reminder-scan.js";
import { scanChoreReminders } from "./chore-reminder-scan.js";
import { setSyncRun } from "./sync-run.js";
import type { SyncJobPayload } from "./index.js";

const DEFAULT_CATEGORY_KEY = "general";

async function defaultCategoryKeyForCalendar(
  db: Database,
  calendarId: string,
): Promise<string> {
  const [row] = await db
    .select({ key: eventCategories.key })
    .from(eventCategories)
    .where(and(eq(eventCategories.calendarId, calendarId), eq(eventCategories.isDefault, true)))
    .limit(1);
  return row?.key ?? DEFAULT_CATEGORY_KEY;
}

/** Drop cached Google sync tokens so the next pull re-fetches all events (e.g. color backfill). */
export async function resetGoogleSyncTokens(
  db: Database,
  connectionId: string,
  linkedCalendarId?: string,
): Promise<void> {
  if (linkedCalendarId) {
    await db
      .update(linkedGoogleCalendars)
      .set({ syncToken: null })
      .where(
        and(
          eq(linkedGoogleCalendars.id, linkedCalendarId),
          eq(linkedGoogleCalendars.connectionId, connectionId),
        ),
      );
    return;
  }
  await db
    .update(linkedGoogleCalendars)
    .set({ syncToken: null })
    .where(eq(linkedGoogleCalendars.connectionId, connectionId));
}

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

  const defaultCategoryKey = await defaultCategoryKeyForCalendar(db, targetCalendarId);

  for (const event of resp.items ?? []) {
    if (event.status === "cancelled") {
      const gid = event.id ? String(event.id) : null;
      if (gid) {
        await db
          .delete(calendarEvents)
          .where(
            and(
              eq(calendarEvents.householdId, conn.householdId),
              eq(calendarEvents.googleEventId, gid),
            ),
          );
      }
      continue;
    }
    const fields = eventToFields(event, tz);
    if (!fields.googleEventId) continue;
    fields.categoryKey = defaultCategoryKey;
    fields.color = null;

    let existing =
      (await findExistingGoogleEvent(
        db,
        conn.householdId,
        fields.googleEventId,
        targetCalendarId,
      )) ??
      (await findFuzzyGoogleEventMatch(db, conn.householdId, fields));

    if (existing) {
      if (existing.syncStatus === "pending") continue;
      await db
        .update(calendarEvents)
        .set({
          calendarId: targetCalendarId,
          title: fields.title,
          description: fields.description,
          startDate: fields.startDate,
          endDate: fields.endDate,
          startTime: fields.startTime,
          endTime: fields.endTime,
          allDay: fields.allDay,
          timeZone: fields.timeZone,
          googleEventId: fields.googleEventId,
          googleEtag: fields.googleEtag,
          categoryKey: fields.categoryKey,
          color: fields.color,
          source: "google",
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

  if (forcePull) {
    await resetGoogleSyncTokens(db, connectionId);
  }

  const linked = await db
    .select()
    .from(linkedGoogleCalendars)
    .where(eq(linkedGoogleCalendars.connectionId, connectionId));

  const enabled = linked.filter((lc) => lc.syncEnabled && lc.targetCalendarId);
  await setSyncRun(db, connectionId, {
    status: "syncing",
    progress: { done: 0, total: enabled.length, current: enabled[0]?.summary ?? undefined },
    error: null,
  });

  let done = 0;
  try {
    for (const lc of enabled) {
      await setSyncRun(db, connectionId, {
        status: "syncing",
        progress: {
          done,
          total: enabled.length,
          current: lc.summary ?? lc.googleCalendarId,
        },
        error: null,
      });
      await pullLinkedCalendar(db, env, lc.id);
      done += 1;
    }
    await dedupeHouseholdGoogleEvents(db, conn.householdId);
    if (conn.syncMode === "bidirectional") {
      await processOutboxForConnection(db, env, connectionId);
    }
    await setSyncRun(db, connectionId, {
      status: "idle",
      progress: null,
      error: null,
      touchLastSync: true,
    });
  } catch (e) {
    await setSyncRun(db, connectionId, {
      status: "failed",
      progress: { done, total: enabled.length },
      error: String(e),
    });
    throw e;
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
    case "google.calendar.full_import": {
      const connectionId = payload.connectionId;
      if (!connectionId) throw new Error("connectionId required for calendar sync");
      try {
        if (payload.linkedCalendarId) {
          await resetGoogleSyncTokens(db, connectionId, payload.linkedCalendarId);
          await setSyncRun(db, connectionId, {
            status: "syncing",
            progress: { done: 0, total: 1 },
            error: null,
          });
          await pullLinkedCalendar(db, env, payload.linkedCalendarId);
          await dedupeHouseholdGoogleEvents(db, payload.householdId);
          await setSyncRun(db, connectionId, {
            status: "idle",
            progress: null,
            error: null,
            touchLastSync: true,
          });
        } else {
          await syncConnection(db, env, connectionId, true);
        }
      } catch (e) {
        await setSyncRun(db, connectionId, {
          status: "failed",
          progress: null,
          error: String(e),
        });
        throw e;
      }
      break;
    }
    case "google.calendar.push": {
      if (!payload.connectionId) throw new Error("connectionId required for calendar push");
      await processOutboxForConnection(db, env, payload.connectionId);
      break;
    }
    case "recurring.materialize":
      await materializeRecurringForHousehold(db, payload.householdId);
      break;
    case "calendar.reminder.scan":
      await scanCalendarReminders(db, env);
      break;
    case "chore.reminder.scan":
      await scanChoreReminders(db, env);
      break;
    default:
      throw new Error(`Unknown sync job: ${name}`);
  }
}
