import { Hono } from "hono";
import type { Env } from "@whome/config";
import { isModuleEnabled } from "@whome/config";
import { isHouseholdModuleEnabled, requireHouseholdModule } from "../lib/household-modules.js";
import type { Database } from "@whome/db";
import {
  calendarCategoryImportMappings,
  calendarConnections,
  calendarEvents,
  calendarShares,
  calendarSyncOutbox,
  calendars,
  eventCategories,
  householdMembers,
  linkedGoogleCalendars,
  recurringRules,
  users,
} from "@whome/db";
import {
  dedupeHouseholdGoogleEvents,
  ensureAccessToken,
  enqueueSyncJob,
  inferGoogleCategories,
  listGoogleCalendars,
  materializeRecurringForHousehold,
  normalizeCategorySourceKey,
} from "@whome/calendar-sync";
import { and, asc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import {
  ensureDefaultCategory,
  ensureDefaultCategoriesForHousehold,
  listEventCategories,
  seedCategoriesFromEvents,
  slugCategoryKey,
  validateCategoryKeyForCalendar,
} from "../lib/calendar-event-categories.js";
import {
  normalizeHexColor,
  resolveTargetCalendar,
} from "../lib/calendar-import.js";
import {
  buildCalendarSyncStatus,
  markSyncQueued,
} from "../lib/calendar-sync-status.js";
import {
  computeEventPolicy,
  isSchedulePatch,
  loadEventPolicyContext,
  toEventDto,
} from "../lib/calendar-event-policy.js";
import {
  canWriteCalendar,
  listVisibleCalendars,
  setHouseholdDefaultCalendar,
} from "../lib/calendar-lanes.js";
import { enrichEventDto } from "../lib/calendar-event-enrich.js";
import {
  listReminderOffsetsForEvent,
  normalizeReminderOffsets,
  replaceEventReminders,
} from "../lib/calendar-event-reminders.js";
import { buildRrule } from "../lib/calendar-repeat.js";

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

  app.get("/sync/status", async (c) => {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "calendar_sync"))) {
      return c.json({ enabled: false });
    }
    const status = await buildCalendarSyncStatus(db, auth);
    return c.json(status);
  });

  app.use("/*", requireHouseholdModule(db, env, "calendar_sync"));

  app.get("/connections", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select({
        id: calendarConnections.id,
        syncMode: calendarConnections.syncMode,
        lastSyncAt: calendarConnections.lastSyncAt,
        connectedAt: calendarConnections.connectedAt,
        syncRunStatus: calendarConnections.syncRunStatus,
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

  app.patch("/connections/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ syncMode?: string }>();
    const mode = body.syncMode;
    if (mode !== "import_only" && mode !== "manual" && mode !== "bidirectional") {
      return c.json({ error: "invalid_sync_mode", message: "Invalid sync mode." }, 400);
    }
    const [row] = await db
      .update(calendarConnections)
      .set({ syncMode: mode })
      .where(
        and(
          eq(calendarConnections.id, id),
          eq(calendarConnections.householdId, auth.householdId),
          eq(calendarConnections.userId, auth.userId),
        ),
      )
      .returning({
        id: calendarConnections.id,
        syncMode: calendarConnections.syncMode,
        lastSyncAt: calendarConnections.lastSyncAt,
        connectedAt: calendarConnections.connectedAt,
        syncRunStatus: calendarConnections.syncRunStatus,
      });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ connection: row });
  });

  app.get("/calendars", async (c) => {
    const auth = c.get("auth")!;
    const rows = await listVisibleCalendars(db, auth.householdId, auth.userId);
    const ids = rows.map((r) => r.id);
    const shareCounts =
      ids.length > 0
        ? await db
            .select({
              calendarId: calendarShares.calendarId,
              count: sql<number>`cast(count(*) as int)`,
            })
            .from(calendarShares)
            .where(inArray(calendarShares.calendarId, ids))
            .groupBy(calendarShares.calendarId)
        : [];
    const shareCountById = new Map(shareCounts.map((r) => [r.calendarId, Number(r.count)]));
    return c.json({
      calendars: rows.map((row) => ({
        ...row,
        shareCount: shareCountById.get(row.id) ?? 0,
      })),
    });
  });

  app.post("/calendars", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      name?: string;
      color?: string | null;
      visibility?: "household" | "private";
    }>();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "name_required" }, 400);
    const visibility = body.visibility === "private" ? "private" : "household";
    const [row] = await db
      .insert(calendars)
      .values({
        householdId: auth.householdId,
        ownerUserId: visibility === "private" ? auth.userId : null,
        name: name.slice(0, 128),
        color: body.color ? normalizeHexColor(body.color) : null,
        visibility,
        isHouseholdDefault: false,
      })
      .returning();
    await ensureDefaultCategory(db, auth.householdId, row.id, {
      color: row.color,
    });
    return c.json({ calendar: row }, 201);
  });

  app.patch("/calendars/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      name?: string;
      color?: string | null;
      visibility?: "household" | "private";
      archived?: boolean;
      isHouseholdDefault?: boolean;
    }>();
    const [existing] = await db
      .select()
      .from(calendars)
      .where(and(eq(calendars.id, id), eq(calendars.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const updates: {
      name?: string;
      color?: string | null;
      visibility?: "household" | "private";
      archived?: boolean;
      ownerUserId?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return c.json({ error: "name_required" }, 400);
      updates.name = name.slice(0, 128);
    }
    if (body.color !== undefined) {
      updates.color = body.color ? normalizeHexColor(body.color) : null;
    }
    if (body.visibility === "household" || body.visibility === "private") {
      updates.visibility = body.visibility;
      updates.ownerUserId = body.visibility === "private" ? auth.userId : null;
    }
    if (body.archived === true) updates.archived = true;
    if (body.archived === false) updates.archived = false;

    const hasLanePatch =
      updates.name !== undefined ||
      body.color !== undefined ||
      body.visibility !== undefined ||
      body.archived !== undefined;

    if (!hasLanePatch && body.isHouseholdDefault !== true) {
      return c.json({ error: "no_changes" }, 400);
    }

    if (body.isHouseholdDefault === true) {
      await setHouseholdDefaultCalendar(db, auth.householdId, id);
    }

    const [row] = await db
      .update(calendars)
      .set(updates)
      .where(eq(calendars.id, id))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ calendar: row });
  });

  app.get("/members", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select({
        userId: householdMembers.userId,
        displayName: users.displayName,
        email: users.email,
      })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, auth.householdId))
      .orderBy(asc(users.displayName));
    return c.json({ members: rows });
  });

  app.get("/calendars/:id/shares", async (c) => {
    const auth = c.get("auth")!;
    const calendarId = c.req.param("id");
    const [cal] = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.id, calendarId), eq(calendars.householdId, auth.householdId)))
      .limit(1);
    if (!cal) return c.json({ error: "not_found" }, 404);
    const rows = await db
      .select({
        userId: calendarShares.granteeUserId,
        canWrite: calendarShares.canWrite,
        displayName: users.displayName,
      })
      .from(calendarShares)
      .innerJoin(users, eq(users.id, calendarShares.granteeUserId))
      .where(eq(calendarShares.calendarId, calendarId));
    return c.json({ shares: rows });
  });

  app.patch("/calendars/:id/shares", async (c) => {
    const auth = c.get("auth")!;
    const calendarId = c.req.param("id");
    const body = await c.req.json<{
      shares?: { userId: string; canWrite?: boolean }[];
    }>();
    const [cal] = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.id, calendarId), eq(calendars.householdId, auth.householdId)))
      .limit(1);
    if (!cal) return c.json({ error: "not_found" }, 404);
    await db.delete(calendarShares).where(eq(calendarShares.calendarId, calendarId));
    const shares = Array.isArray(body.shares) ? body.shares : [];
    if (shares.length > 0) {
      await db.insert(calendarShares).values(
        shares.map((s) => ({
          calendarId,
          granteeUserId: s.userId,
          canWrite: Boolean(s.canWrite),
        })),
      );
    }
    return c.json({ ok: true });
  });

  app.post("/recurring/materialize", async (c) => {
    const auth = c.get("auth")!;
    const count = await materializeRecurringForHousehold(db, auth.householdId);
    return c.json({ materialized: count });
  });

  /** Merge duplicate lane rows (e.g. repeated HomeHub imports of the same bucket name). */
  app.post("/calendars/consolidate-duplicates", async (c) => {
    const auth = c.get("auth")!;
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const targetName = (body.name ?? "Imported from HomeHub").trim();
    const rows = await db
      .select()
      .from(calendars)
      .where(
        and(eq(calendars.householdId, auth.householdId), eq(calendars.archived, false)),
      );
    const dupes = rows.filter((cal) => cal.name === targetName);
    if (dupes.length <= 1) {
      return c.json({ merged: 0, keptCalendarId: dupes[0]?.id ?? null });
    }
    dupes.sort((a, b) => {
      if (a.isHouseholdDefault !== b.isHouseholdDefault) {
        return a.isHouseholdDefault ? -1 : 1;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keeper = dupes[0]!;
    let merged = 0;
    for (const cal of dupes.slice(1)) {
      await db
        .update(calendarEvents)
        .set({ calendarId: keeper.id, updatedAt: new Date() })
        .where(
          and(
            eq(calendarEvents.calendarId, cal.id),
            eq(calendarEvents.householdId, auth.householdId),
          ),
        );
      await db
        .update(calendars)
        .set({ archived: true, updatedAt: new Date() })
        .where(eq(calendars.id, cal.id));
      merged += 1;
    }
    return c.json({ merged, keptCalendarId: keeper.id, name: targetName });
  });

  app.get("/events", async (c) => {
    const auth = c.get("auth")!;
    const from = c.req.query("from") ?? new Date().toISOString().slice(0, 10);
    const to =
      c.req.query("to") ??
      new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const q = c.req.query("q")?.trim();

    const visible = await listVisibleCalendars(db, auth.householdId, auth.userId);
    const visibleIds = visible.map((c) => c.id);
    if (visibleIds.length === 0) return c.json({ events: [] });

    const conditions = [
      eq(calendarEvents.householdId, auth.householdId),
      inArray(calendarEvents.calendarId, visibleIds),
      lte(calendarEvents.startDate, to),
      gte(
        sql`COALESCE(${calendarEvents.endDate}, ${calendarEvents.startDate})`,
        from,
      ),
    ];
    if (q) conditions.push(ilike(calendarEvents.title, `%${q}%`));

    const rows = await db
      .select()
      .from(calendarEvents)
      .where(and(...conditions))
      .orderBy(asc(calendarEvents.startDate), asc(calendarEvents.startTime));

    const policyCtx = await loadEventPolicyContext(db, auth.householdId, auth.userId);
    const events = await Promise.all(
      rows.map((row) => enrichEventDto(db, auth.householdId, row, computeEventPolicy(row, policyCtx))),
    );
    return c.json({ events });
  });

  app.get("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [row] = await db
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.householdId, auth.householdId)))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);

    const visible = await listVisibleCalendars(db, auth.householdId, auth.userId);
    if (!visible.some((cal) => cal.id === row.calendarId)) {
      return c.json({ error: "not_found" }, 404);
    }

    const policyCtx = await loadEventPolicyContext(db, auth.householdId, auth.userId);
    const event = await enrichEventDto(db, auth.householdId, row, computeEventPolicy(row, policyCtx));
    return c.json({ event });
  });

  app.post("/sync", async (c) => {
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

    await markSyncQueued(db, conn.id);
    const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
    await enqueueSyncJob(redisUrl, "google.calendar.full_import", {
      connectionId: conn.id,
      householdId: auth.householdId,
      userId: auth.userId,
    });
    return c.json({ queued: true, status: "queued", fullResync: true });
  });

  app.post("/dedupe", async (c) => {
    const auth = c.get("auth")!;
    const removed = await dedupeHouseholdGoogleEvents(db, auth.householdId);
    return c.json({ ok: true, removed });
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

  async function connectionForUser(auth: { userId: string; householdId: string }) {
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
    return conn ?? null;
  }

  app.post("/import/refresh-sources", async (c) => {
    const auth = c.get("auth")!;
    const conn = await connectionForUser(auth);
    if (!conn) return c.json({ error: "not_connected" }, 400);

    const accessToken = await ensureAccessToken(db, env, conn);
    const gCalList = await listGoogleCalendars(accessToken);
    let added = 0;
    for (const item of gCalList) {
      const gId = String(item.id ?? "");
      if (!gId) continue;
      const [linked] = await db
        .select()
        .from(linkedGoogleCalendars)
        .where(
          and(
            eq(linkedGoogleCalendars.connectionId, conn.id),
            eq(linkedGoogleCalendars.googleCalendarId, gId),
          ),
        )
        .limit(1);
      if (!linked) {
        await db.insert(linkedGoogleCalendars).values({
          connectionId: conn.id,
          googleCalendarId: gId,
          summary: String(item.summary ?? ""),
          backgroundColor: String(item.backgroundColor ?? ""),
          syncEnabled: false,
          targetCalendarId: null,
        });
        added += 1;
      } else {
        await db
          .update(linkedGoogleCalendars)
          .set({
            summary: String(item.summary ?? linked.summary ?? ""),
            backgroundColor: String(item.backgroundColor ?? linked.backgroundColor ?? ""),
          })
          .where(eq(linkedGoogleCalendars.id, linked.id));
      }
    }
    return c.json({ ok: true, added });
  });

  app.get("/import/options", async (c) => {
    const auth = c.get("auth")!;
    const conn = await connectionForUser(auth);
    if (!conn) return c.json({ error: "not_connected" }, 400);

    const linked = await db
      .select()
      .from(linkedGoogleCalendars)
      .where(eq(linkedGoogleCalendars.connectionId, conn.id))
      .orderBy(asc(linkedGoogleCalendars.summary));

    const targetCalendars = await db
      .select({
        id: calendars.id,
        name: calendars.name,
        color: calendars.color,
        visibility: calendars.visibility,
      })
      .from(calendars)
      .where(
        and(eq(calendars.householdId, auth.householdId), eq(calendars.archived, false)),
      )
      .orderBy(asc(calendars.name));

    const calendarById = new Map(targetCalendars.map((cal) => [cal.id, cal]));
    const accessToken = await ensureAccessToken(db, env, conn);

    const linkedCalendars = await Promise.all(
      linked.map(async (lc) => {
        const target = lc.targetCalendarId
          ? calendarById.get(lc.targetCalendarId)
          : undefined;
        const fallback = lc.backgroundColor ?? "#3b82f6";
        const inferred = await inferGoogleCategories(
          accessToken,
          lc.googleCalendarId,
          fallback,
        );
        const catRows = await db
          .select()
          .from(calendarCategoryImportMappings)
          .where(
            and(
              eq(calendarCategoryImportMappings.connectionId, conn.id),
              eq(calendarCategoryImportMappings.linkedCalendarId, lc.id),
            ),
          );
        const knownKeys = new Set(inferred.map((c) => normalizeCategorySourceKey(c.key)));
        for (const row of catRows) {
          const norm = normalizeCategorySourceKey(row.sourceKey ?? "");
          if (norm && !knownKeys.has(norm)) {
            inferred.push({
              key: norm,
              label: row.sourceLabel ?? norm,
              color: row.targetColor ?? fallback,
            });
            knownKeys.add(norm);
          }
        }
        return {
          id: lc.id,
          googleCalendarId: lc.googleCalendarId,
          summary: lc.summary,
          backgroundColor: lc.backgroundColor,
          syncEnabled: lc.syncEnabled,
          targetCalendarId: lc.targetCalendarId,
          targetCalendarName: target?.name ?? null,
          importColor: target?.color ?? lc.backgroundColor,
          sourceCategories: inferred,
          categoryMappings: catRows.map((row) => ({
            sourceKey: row.sourceKey,
            sourceLabel: row.sourceLabel,
            targetKey: row.targetKey,
            targetLabel: row.targetLabel,
            targetColor: row.targetColor,
          })),
        };
      }),
    );

    return c.json({
      syncMode: conn.syncMode,
      linkedCalendars,
      targetCalendars,
    });
  });

  app.post("/import/preview", async (c) => {
    const auth = c.get("auth")!;
    const conn = await connectionForUser(auth);
    if (!conn) return c.json({ error: "not_connected" }, 400);
    const body = await c.req.json<{ selections?: unknown }>();
    const selections = Array.isArray(body.selections) ? body.selections : [];
    let selected = 0;
    for (const row of selections) {
      if (!row || typeof row !== "object") continue;
      const s = row as { importEnabled?: boolean };
      if (s.importEnabled !== false) selected += 1;
    }
    return c.json({
      summary: {
        selectedCalendars: selected,
        mode: conn.syncMode,
      },
    });
  });

  app.post("/import/commit", async (c) => {
    const auth = c.get("auth")!;
    const conn = await connectionForUser(auth);
    if (!conn) return c.json({ error: "not_connected" }, 400);

    const body = await c.req.json<{ selections?: unknown }>();
    const selections = Array.isArray(body.selections) ? body.selections : [];
    if (!selections.length) {
      return c.json({ error: "invalid_payload" }, 400);
    }

    let saved = 0;
    for (const raw of selections) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as {
        linkedCalendarId?: string;
        importEnabled?: boolean;
        targetCalendarId?: string | null;
        newCalendarName?: string;
        newCalendarColor?: string;
        importColor?: string;
      };
      const linkedId = s.linkedCalendarId;
      if (!linkedId) continue;

      const [lc] = await db
        .select()
        .from(linkedGoogleCalendars)
        .where(
          and(
            eq(linkedGoogleCalendars.id, linkedId),
            eq(linkedGoogleCalendars.connectionId, conn.id),
          ),
        )
        .limit(1);
      if (!lc) continue;

      const importEnabled = s.importEnabled !== false;
      let targetCalendarId = lc.targetCalendarId;

      if (importEnabled) {
        try {
          targetCalendarId = await resolveTargetCalendar(db, {
            householdId: auth.householdId,
            ownerUserId: auth.userId,
            targetCalendarId: s.targetCalendarId ?? lc.targetCalendarId,
            newCalendarName: s.newCalendarName,
            fallbackName: lc.summary ?? lc.googleCalendarId,
            newCalendarColor: s.newCalendarColor ?? s.importColor,
            fallbackColor: lc.backgroundColor,
          });
          const laneColor = normalizeHexColor(
            s.importColor ?? s.newCalendarColor ?? lc.backgroundColor,
            "#3b82f6",
          );
          await db
            .update(calendars)
            .set({ color: laneColor, updatedAt: new Date() })
            .where(eq(calendars.id, targetCalendarId));
          await ensureDefaultCategory(db, auth.householdId, targetCalendarId, {
            color: laneColor,
          });
        } catch (err) {
          console.error("import/commit resolveTargetCalendar", linkedId, err);
          return c.json(
            {
              error: "target_calendar_required",
              message:
                "Choose or name a destination whome calendar for each imported Google source.",
              linkedCalendarId: linkedId,
            },
            400,
          );
        }
      }

      await db
        .update(linkedGoogleCalendars)
        .set({
          syncEnabled: importEnabled,
          targetCalendarId: importEnabled ? targetCalendarId : lc.targetCalendarId,
        })
        .where(eq(linkedGoogleCalendars.id, lc.id));

      saved += 1;
    }

    if (saved === 0) {
      return c.json({ error: "no_calendars_saved", message: "No valid Google calendars in import request." }, 400);
    }

    try {
      await markSyncQueued(db, conn.id);
      const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
      await enqueueSyncJob(redisUrl, "google.calendar.full_import", {
        connectionId: conn.id,
        householdId: auth.householdId,
        userId: auth.userId,
      });
    } catch (err) {
      console.error("import/commit enqueue", err);
      return c.json(
        {
          error: "sync_queue_failed",
          message: "Mappings saved but sync could not be queued. Is Redis running?",
          saved,
        },
        503,
      );
    }

    return c.json({ ok: true, saved, queued: true });
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
      categoryKey?: string;
      timeZone?: string;
      calendarId?: string;
      repeatWeekly?: boolean;
      repeatRule?: { freq: "daily" | "weekly" | "monthly"; interval?: number; until?: string; count?: number };
      reminderOffsets?: number[];
    }>();
    const calendarId = body.calendarId ?? (await defaultCalendarId(auth.householdId));
    const canWrite = await canWriteCalendar(db, calendarId, auth.householdId, auth.userId);
    if (!canWrite) {
      return c.json({ error: "forbidden", message: "You cannot create events on this calendar." }, 403);
    }

    if (body.categoryKey) {
      const ok = await validateCategoryKeyForCalendar(
        db,
        auth.householdId,
        calendarId,
        body.categoryKey,
      );
      if (!ok) return c.json({ error: "invalid_category" }, 400);
    }

    const allDay = body.allDay ?? false;
    const eventColor = body.categoryKey ? null : body.color ? normalizeHexColor(body.color) : null;
    const repeatRule =
      body.repeatRule ?? (body.repeatWeekly && allDay ? { freq: "weekly" as const } : null);

    if (repeatRule?.freq) {
      const freq = repeatRule.freq;
      const offsets = normalizeReminderOffsets(body.reminderOffsets);
      const [rule] = await db
        .insert(recurringRules)
        .values({
          householdId: auth.householdId,
          calendarId,
          title: body.title,
          description: body.description,
          rrule: buildRrule({
            freq,
            interval: repeatRule.interval,
            until: repeatRule.until,
            count: repeatRule.count,
            startDate: body.startDate,
          }),
          startDate: body.startDate,
          endDate: body.endDate,
          startTime: allDay ? null : body.startTime ?? null,
          endTime: allDay ? null : body.endTime ?? null,
          allDay,
          categoryKey: body.categoryKey,
          color: eventColor,
          reminderOffsetsJson: offsets.length > 0 ? offsets : null,
        })
        .returning();
      const [ev] = await db
        .insert(calendarEvents)
        .values({
          householdId: auth.householdId,
          calendarId,
          title: body.title,
          description: body.description,
          categoryKey: body.categoryKey,
          startDate: body.startDate,
          endDate: body.endDate,
          startTime: allDay ? null : body.startTime,
          endTime: allDay ? null : body.endTime,
          allDay,
          color: eventColor,
          timeZone: body.timeZone,
          source: "local",
          recurringRuleId: rule!.id,
          createdByUserId: auth.userId,
        })
        .returning();
      if (offsets.length) await replaceEventReminders(db, ev!.id, auth.householdId, offsets);
      const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
      if (isModuleEnabled(env, "calendar_sync")) {
        await enqueueSyncJob(redisUrl, "recurring.materialize", { householdId: auth.householdId });
      } else {
        await materializeRecurringForHousehold(db, auth.householdId);
      }
      const policyCtx = await loadEventPolicyContext(db, auth.householdId, auth.userId);
      return c.json(
        { event: await enrichEventDto(db, auth.householdId, ev!, computeEventPolicy(ev!, policyCtx)) },
        201,
      );
    }

    const [ev] = await db
      .insert(calendarEvents)
      .values({
        householdId: auth.householdId,
        calendarId,
        title: body.title,
        description: body.description,
        categoryKey: body.categoryKey,
        startDate: body.startDate,
        endDate: body.endDate,
        startTime: allDay ? null : body.startTime,
        endTime: allDay ? null : body.endTime,
        allDay,
        color: eventColor,
        timeZone: body.timeZone,
        source: "local",
        createdByUserId: auth.userId,
      })
      .returning();
    const offsets = normalizeReminderOffsets(body.reminderOffsets);
    if (offsets.length) await replaceEventReminders(db, ev!.id, auth.householdId, offsets);
    const policyCtx = await loadEventPolicyContext(db, auth.householdId, auth.userId);
    return c.json(
      { event: await enrichEventDto(db, auth.householdId, ev!, computeEventPolicy(ev!, policyCtx)) },
      201,
    );
  });

  app.patch("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const recurringScope = c.req.query("recurringScope");
    const body = await c.req.json<{
      title?: string;
      description?: string;
      startDate?: string;
      endDate?: string;
      startTime?: string | null;
      endTime?: string | null;
      allDay?: boolean;
      color?: string;
      categoryKey?: string | null;
      calendarId?: string;
      timeZone?: string | null;
      reminderOffsets?: number[];
    }>();
    const [existing] = await db
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const policyCtx = await loadEventPolicyContext(db, auth.householdId, auth.userId);
    const policy = computeEventPolicy(existing, policyCtx);
    if (!policy.editable) {
      return c.json(
        { error: "not_editable", message: "This event cannot be edited (sync conflict)." },
        403,
      );
    }

    const scheduleChange = isSchedulePatch(body, existing);
    const pushAfter =
      scheduleChange && policy.pushable && policy.linkedCalendarId && policy.connectionId;

    const targetCalendarId = body.calendarId ?? existing.calendarId;
    if (body.categoryKey !== undefined) {
      const ok = await validateCategoryKeyForCalendar(
        db,
        auth.householdId,
        targetCalendarId,
        body.categoryKey,
      );
      if (!ok) return c.json({ error: "invalid_category" }, 400);
    }

    const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
    if (body.categoryKey) patch.color = null;
    else if (body.color !== undefined) {
      patch.color = body.color ? normalizeHexColor(body.color) : null;
    }
    if (pushAfter) patch.syncStatus = "pending";

    if (existing.recurringRuleId && scheduleChange) {
      if (recurringScope === "this") {
        patch.recurringRuleId = null;
      } else if (recurringScope === "series" && body.startDate) {
        await db
          .update(recurringRules)
          .set({ startDate: body.startDate })
          .where(eq(recurringRules.id, existing.recurringRuleId));
      }
    }

    const [ev] = await db
      .update(calendarEvents)
      .set(patch)
      .where(eq(calendarEvents.id, id))
      .returning();
    if (!ev) return c.json({ error: "not_found" }, 404);

    if (pushAfter && isModuleEnabled(env, "calendar_sync")) {
      await db.insert(calendarSyncOutbox).values({
        eventId: ev.id,
        operation: "update",
        payloadJson: JSON.stringify({ linkedCalendarId: policy.linkedCalendarId }),
      });
      const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
      await enqueueSyncJob(redisUrl, "google.calendar.push", {
        connectionId: policy.connectionId!,
        householdId: auth.householdId,
        userId: auth.userId,
      });
    }

    if (body.reminderOffsets !== undefined) {
      const offsets = normalizeReminderOffsets(body.reminderOffsets);
      await replaceEventReminders(db, ev.id, auth.householdId, offsets);
      if (existing.recurringRuleId && recurringScope === "series") {
        await db
          .update(recurringRules)
          .set({ reminderOffsetsJson: offsets.length > 0 ? offsets : null })
          .where(eq(recurringRules.id, existing.recurringRuleId));
        const siblings = await db
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .where(eq(calendarEvents.recurringRuleId, existing.recurringRuleId));
        for (const sibling of siblings) {
          if (sibling.id === ev.id) continue;
          await replaceEventReminders(db, sibling.id, auth.householdId, offsets);
        }
      }
    }

    const outPolicy = computeEventPolicy(ev, policyCtx);
    return c.json({ event: await enrichEventDto(db, auth.householdId, ev, outPolicy) });
  });

  app.post("/events/:id/duplicate", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const [ev] = await db
      .insert(calendarEvents)
      .values({
        householdId: existing.householdId,
        calendarId: existing.calendarId,
        title: `${existing.title} (copy)`.slice(0, 256),
        description: existing.description,
        categoryKey: existing.categoryKey,
        color: existing.color,
        startDate: existing.startDate,
        endDate: existing.endDate,
        startTime: existing.startTime,
        endTime: existing.endTime,
        timeZone: existing.timeZone,
        allDay: existing.allDay,
        source: "local",
        syncStatus: "synced",
        createdByUserId: auth.userId,
      })
      .returning();
    const offsets = await listReminderOffsetsForEvent(db, existing.id);
    if (offsets.length && ev) {
      await replaceEventReminders(db, ev.id, auth.householdId, offsets);
    }
    const policyCtx = await loadEventPolicyContext(db, auth.householdId, auth.userId);
    return c.json(
      { event: await enrichEventDto(db, auth.householdId, ev!, computeEventPolicy(ev!, policyCtx)) },
      201,
    );
  });

  app.delete("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const recurringScope = c.req.query("recurringScope");
    const [existing] = await db
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    if (existing.recurringRuleId && recurringScope === "series") {
      await db
        .delete(calendarEvents)
        .where(eq(calendarEvents.recurringRuleId, existing.recurringRuleId));
      await db.delete(recurringRules).where(eq(recurringRules.id, existing.recurringRuleId));
    } else {
      await db
        .delete(calendarEvents)
        .where(and(eq(calendarEvents.id, id), eq(calendarEvents.householdId, auth.householdId)));
    }
    return c.json({ ok: true });
  });

  app.get("/event-categories", async (c) => {
    const auth = c.get("auth")!;
    const calendarId = c.req.query("calendarId")?.trim();
    await ensureDefaultCategoriesForHousehold(
      db,
      auth.householdId,
      calendarId || undefined,
    );
    const categories = await listEventCategories(
      db,
      auth.householdId,
      calendarId || undefined,
    );
    return c.json({ categories });
  });

  app.post("/event-categories", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      calendarId: string;
      label: string;
      key?: string;
      color?: string;
      sortOrder?: number;
    }>();
    const calendarId = body.calendarId?.trim();
    const label = body.label?.trim();
    if (!calendarId) return c.json({ error: "calendar_id_required" }, 400);
    if (!label) return c.json({ error: "label_required" }, 400);
    const [cal] = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.id, calendarId), eq(calendars.householdId, auth.householdId)))
      .limit(1);
    if (!cal) return c.json({ error: "calendar_not_found" }, 404);
    const key = (body.key?.trim() || slugCategoryKey(label)).slice(0, 64);
    const [row] = await db
      .insert(eventCategories)
      .values({
        householdId: auth.householdId,
        calendarId,
        key,
        label: label.slice(0, 128),
        color: body.color ? normalizeHexColor(body.color) : null,
        sortOrder: body.sortOrder ?? 0,
        isDefault: false,
      })
      .returning();
    return c.json({ category: row }, 201);
  });

  app.patch("/event-categories/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ label?: string; color?: string | null; sortOrder?: number }>();
    const [row] = await db
      .update(eventCategories)
      .set({
        ...(body.label ? { label: body.label.trim().slice(0, 128) } : {}),
        ...(body.color !== undefined
          ? { color: body.color ? normalizeHexColor(body.color) : null }
          : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(eventCategories.id, id), eq(eventCategories.householdId, auth.householdId)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ category: row });
  });

  app.delete("/event-categories/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(eventCategories)
      .where(and(eq(eventCategories.id, id), eq(eventCategories.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.post("/event-categories/seed-from-events", async (c) => {
    const auth = c.get("auth")!;
    const body = (await c.req.json().catch(() => ({}))) as { calendarId?: string };
    const calendarId = body.calendarId?.trim();
    if (!calendarId) return c.json({ error: "calendar_id_required" }, 400);
    const [cal] = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.id, calendarId), eq(calendars.householdId, auth.householdId)))
      .limit(1);
    if (!cal) return c.json({ error: "calendar_not_found" }, 404);
    const created = await seedCategoriesFromEvents(db, auth.householdId, calendarId);
    const categories = await listEventCategories(db, auth.householdId, calendarId);
    return c.json({ created, categories });
  });

  return app;
}
