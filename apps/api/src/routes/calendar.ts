import { Hono } from "hono";
import type { Env } from "@whome/config";
import { isModuleEnabled } from "@whome/config";
import type { Database } from "@whome/db";
import {
  calendarConnections,
  calendarEvents,
  calendars,
  linkedGoogleCalendars,
} from "@whome/db";
import { enqueueSyncJob } from "@whome/calendar-sync";
import { and, asc, eq, gte, ilike, lte } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function calendarRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/status", (c) => {
    if (!isModuleEnabled(env, "calendar_sync")) {
      return c.json({ enabled: false });
    }
    return c.json({
      enabled: true,
      defaultSyncMode: env.GOOGLE_CALENDAR_DEFAULT_SYNC_MODE,
      oauthConfigured: Boolean(
        env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET,
      ),
    });
  });

  app.use("/*", requireAuth(env));

  app.get("/connections", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select({
        id: calendarConnections.id,
        syncMode: calendarConnections.syncMode,
        lastSyncAt: calendarConnections.lastSyncAt,
        connectedAt: calendarConnections.connectedAt,
      })
      .from(calendarConnections)
      .where(
        and(
          eq(calendarConnections.householdId, auth.householdId),
          eq(calendarConnections.userId, auth.userId),
        ),
      );
    return c.json({ connections: rows });
  });

  app.get("/calendars", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(calendars)
      .where(eq(calendars.householdId, auth.householdId));
    return c.json({ calendars: rows });
  });

  app.get("/events", async (c) => {
    const auth = c.get("auth")!;
    const from = c.req.query("from") ?? new Date().toISOString().slice(0, 10);
    const to =
      c.req.query("to") ??
      new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const q = c.req.query("q")?.trim();

    const conditions = [
      eq(calendarEvents.householdId, auth.householdId),
      gte(calendarEvents.startDate, from),
      lte(calendarEvents.startDate, to),
    ];
    if (q) conditions.push(ilike(calendarEvents.title, `%${q}%`));

    const events = await db
      .select()
      .from(calendarEvents)
      .where(and(...conditions))
      .orderBy(asc(calendarEvents.startDate), asc(calendarEvents.startTime));
    return c.json({ events });
  });

  app.post("/sync", async (c) => {
    if (!isModuleEnabled(env, "calendar_sync")) {
      return c.json({ error: "calendar_sync_disabled" }, 403);
    }
    const auth = c.get("auth")!;
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
    if (!conn) return c.json({ error: "not_connected" }, 404);

    const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
    await enqueueSyncJob(redisUrl, "google.calendar.pull", {
      connectionId: conn.id,
      householdId: auth.householdId,
      userId: auth.userId,
    });
    return c.json({ queued: true });
  });

  app.get("/linked", async (c) => {
    const auth = c.get("auth")!;
    const [conn] = await db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, auth.userId))
      .limit(1);
    if (!conn) return c.json({ linked: [] });
    const linked = await db
      .select()
      .from(linkedGoogleCalendars)
      .where(eq(linkedGoogleCalendars.connectionId, conn.id));
    return c.json({ linked });
  });

  async function defaultCalendarId(householdId: string): Promise<string> {
    const [existing] = await db
      .select()
      .from(calendars)
      .where(
        and(eq(calendars.householdId, householdId), eq(calendars.isHouseholdDefault, true)),
      )
      .limit(1);
    if (existing) return existing.id;
    const [created] = await db
      .insert(calendars)
      .values({
        householdId,
        name: "Household",
        visibility: "household",
        isHouseholdDefault: true,
      })
      .returning();
    return created.id;
  }

  app.post("/events", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title: string;
      description?: string;
      startDate: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      color?: string;
      calendarId?: string;
    }>();
    const calendarId = body.calendarId ?? (await defaultCalendarId(auth.householdId));
    const [ev] = await db
      .insert(calendarEvents)
      .values({
        householdId: auth.householdId,
        calendarId,
        title: body.title,
        description: body.description,
        startDate: body.startDate,
        endDate: body.endDate,
        startTime: body.startTime,
        endTime: body.endTime,
        allDay: body.allDay ?? false,
        color: body.color,
        source: "local",
        createdByUserId: auth.userId,
      })
      .returning();
    return c.json({ event: ev }, 201);
  });

  app.patch("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      description?: string;
      startDate?: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      color?: string;
    }>();
    const [ev] = await db
      .update(calendarEvents)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.householdId, auth.householdId)))
      .returning();
    if (!ev) return c.json({ error: "not_found" }, 404);
    return c.json({ event: ev });
  });

  app.delete("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  return app;
}
