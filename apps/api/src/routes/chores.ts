import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { chores, choresRecurring } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import { todayIsoDate } from "../lib/shopping.js";
import {
  collectChoreListSuggestions,
  collectChoreTagSuggestions,
  materializeDueChoreRecurring,
  normalizeChorePriority,
  normalizeRecurringInterval as normalizeChoreRecurringInterval,
  parseChoreTagsJson,
  promoteChoreToRecurring,
  serializeChore,
  serializeChoreRecurring,
  serializeChoreTagsJson,
} from "../lib/chores.js";
import { buildChoreReports, loadHouseholdKarma, recordChoreCompletion } from "../lib/chores-karma.js";
import { buildChoresGlance } from "../lib/chores-glance.js";
import { posterLabel } from "../lib/poster-label.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function choresRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/chores/karma", async (c) => {
    const auth = c.get("auth")!;
    const members = await loadHouseholdKarma(db, auth.householdId);
    return c.json({ members });
  });

  app.get("/chores/reports", async (c) => {
    const auth = c.get("auth")!;
    const to = c.req.query("to")?.trim() || todayIsoDate();
    const fromDefault = new Date(`${to}T12:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
    const from = c.req.query("from")?.trim() || fromDefault.toISOString().slice(0, 10);
    const report = await buildChoreReports(db, auth.householdId, from, to);
    return c.json(report);
  });

  app.get("/chores/glance", async (c) => {
    const auth = c.get("auth")!;
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select({
        id: chores.id,
        description: chores.description,
        dueDate: chores.dueDate,
        done: chores.done,
        priority: chores.priority,
      })
      .from(chores)
      .where(eq(chores.householdId, auth.householdId));
    return c.json(buildChoresGlance(rows, today));
  });

  app.get("/chores/tag-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectChoreTagSuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/chores/list-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectChoreListSuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/chores/recurring", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(choresRecurring)
      .where(eq(choresRecurring.householdId, auth.householdId))
      .orderBy(choresRecurring.description);
    return c.json({ recurring: rows.map(serializeChoreRecurring) });
  });

  app.post("/chores/recurring", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      description: string;
      list?: string | null;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
      interval?: string;
      nextAt?: string;
    }>();
    const description = body.description?.trim();
    if (!description) return c.json({ error: "description_required" }, 400);
    const interval = normalizeChoreRecurringInterval(body.interval) ?? "weekly";
    const nextAt = body.nextAt?.trim() || todayIsoDate();
    const priority = body.priority !== undefined ? normalizeChorePriority(body.priority) : 0;
    if (body.priority !== undefined && priority === null) {
      return c.json({ error: "invalid_priority" }, 400);
    }
    const [row] = await db
      .insert(choresRecurring)
      .values({
        householdId: auth.householdId,
        description,
        tagsJson: serializeChoreTagsJson(body.list, body.tags ?? []),
        priority: priority ?? 0,
        assigneeMemberId: body.assigneeMemberId ?? null,
        interval,
        nextAt,
      })
      .returning();
    return c.json({ recurring: serializeChoreRecurring(row) }, 201);
  });

  app.patch("/chores/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      description?: string;
      list?: string | null;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
      interval?: string;
      nextAt?: string;
      enabled?: boolean;
    }>();

    const [existing] = await db
      .select()
      .from(choresRecurring)
      .where(and(eq(choresRecurring.id, id), eq(choresRecurring.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof choresRecurring.$inferInsert> = {};
    if (body.description !== undefined) patch.description = body.description.trim();
    if (body.assigneeMemberId !== undefined) patch.assigneeMemberId = body.assigneeMemberId;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.nextAt !== undefined) patch.nextAt = body.nextAt.trim();
    if (body.interval !== undefined) {
      const interval = normalizeChoreRecurringInterval(body.interval);
      if (!interval) return c.json({ error: "invalid_interval" }, 400);
      patch.interval = interval;
    }
    if (body.priority !== undefined) {
      const priority = normalizeChorePriority(body.priority);
      if (priority === null) return c.json({ error: "invalid_priority" }, 400);
      patch.priority = priority;
    }
    if (body.list !== undefined || body.tags !== undefined) {
      const current = parseChoreTagsJson(existing.tagsJson);
      patch.tagsJson = serializeChoreTagsJson(
        body.list !== undefined ? body.list : current.list,
        body.tags ?? current.tags,
      );
    }

    const [row] = await db
      .update(choresRecurring)
      .set(patch)
      .where(and(eq(choresRecurring.id, id), eq(choresRecurring.householdId, auth.householdId)))
      .returning();
    return c.json({ ok: true, recurring: row ? serializeChoreRecurring(row) : undefined });
  });

  app.delete("/chores/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(choresRecurring)
      .where(and(eq(choresRecurring.id, id), eq(choresRecurring.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/chores", async (c) => {
    const auth = c.get("auth")!;
    await materializeDueChoreRecurring(db, auth.householdId);
    const rows = await db
      .select()
      .from(chores)
      .where(eq(chores.householdId, auth.householdId));
    return c.json({ chores: rows.map(serializeChore) });
  });

  app.post("/chores", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      description: string;
      dueDate?: string | null;
      list?: string | null;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
    }>();
    const description = body.description?.trim();
    if (!description) return c.json({ error: "description_required" }, 400);
    const priority = body.priority !== undefined ? normalizeChorePriority(body.priority) : 0;
    if (body.priority !== undefined && priority === null) {
      return c.json({ error: "invalid_priority" }, 400);
    }
    const [row] = await db
      .insert(chores)
      .values({
        householdId: auth.householdId,
        description,
        dueDate: body.dueDate?.trim() || null,
        tagsJson: serializeChoreTagsJson(body.list, body.tags ?? []),
        priority: priority ?? 0,
        assigneeMemberId: body.assigneeMemberId ?? null,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    return c.json({ chore: serializeChore(row) }, 201);
  });

  app.post("/chores/:id/make-recurring", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      interval?: string;
      description?: string;
      list?: string | null;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
      dueDate?: string | null;
    }>();

    const interval = normalizeChoreRecurringInterval(body.interval) ?? "weekly";
    if (body.interval !== undefined && body.interval !== null && body.interval !== "") {
      const normalized = normalizeChoreRecurringInterval(body.interval);
      if (!normalized) return c.json({ error: "invalid_interval" }, 400);
    }

    let priority: ReturnType<typeof normalizeChorePriority> | undefined;
    if (body.priority !== undefined) {
      priority = normalizeChorePriority(body.priority);
      if (priority === null) return c.json({ error: "invalid_priority" }, 400);
    }

    const result = await promoteChoreToRecurring(db, auth.householdId, id, {
      interval,
      description: body.description,
      list: body.list,
      tags: body.tags,
      priority: priority ?? undefined,
      assigneeMemberId: body.assigneeMemberId,
      dueDate: body.dueDate,
    });

    if (!result.ok) {
      if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
      if (result.error === "already_recurring") {
        return c.json({ error: "already_recurring" }, 409);
      }
      if (result.error === "already_completed") {
        return c.json({ error: "already_completed" }, 409);
      }
      return c.json({ error: result.error }, 400);
    }

    return c.json(
      {
        chore: serializeChore(result.chore),
        recurring: serializeChoreRecurring(result.recurring),
      },
      201,
    );
  });

  app.patch("/chores/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      done?: boolean;
      description?: string;
      dueDate?: string | null;
      list?: string | null;
      tags?: string[];
      priority?: number;
      assigneeMemberId?: string | null;
    }>();

    const [existing] = await db
      .select()
      .from(chores)
      .where(and(eq(chores.id, id), eq(chores.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof chores.$inferInsert> & { dueReminderSentAt?: Date | null } = {};
    if (body.done !== undefined) patch.done = body.done;
    if (body.description !== undefined) patch.description = body.description.trim();
    if (body.assigneeMemberId !== undefined) patch.assigneeMemberId = body.assigneeMemberId;
    if (body.dueDate !== undefined) {
      patch.dueDate = body.dueDate?.trim() || null;
      patch.dueReminderSentAt = null;
    }
    if (body.priority !== undefined) {
      const priority = normalizeChorePriority(body.priority);
      if (priority === null) return c.json({ error: "invalid_priority" }, 400);
      patch.priority = priority;
    }
    if (body.list !== undefined || body.tags !== undefined) {
      const current = parseChoreTagsJson(existing.tagsJson);
      patch.tagsJson = serializeChoreTagsJson(
        body.list !== undefined ? body.list : current.list,
        body.tags ?? current.tags,
      );
    }
    if (body.done === true) {
      patch.dueReminderSentAt = null;
    }

    let completion: Awaited<ReturnType<typeof recordChoreCompletion>> | undefined;
    if (body.done === true && !existing.done) {
      completion = await recordChoreCompletion(db, {
        householdId: auth.householdId,
        chore: existing,
        completedByMemberId: auth.memberId,
      });
    }

    const [row] = await db
      .update(chores)
      .set(patch)
      .where(and(eq(chores.id, id), eq(chores.householdId, auth.householdId)))
      .returning();
    return c.json({
      ok: true,
      chore: row ? serializeChore(row) : undefined,
      completion: completion
        ? {
            karmaEarned: completion.karmaEarned,
            timing: completion.timing,
            daysLate: completion.daysLate,
            streakBonus: completion.streakBonus,
            currentStreak: completion.currentStreak,
          }
        : undefined,
    });
  });

  app.delete("/chores/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(chores)
      .where(and(eq(chores.id, id), eq(chores.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  return app;
}
