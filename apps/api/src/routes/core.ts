import { Hono } from "hono";
import type { Env } from "@whome/config";
import { isModuleEnabled } from "@whome/config";
import type { Database } from "@whome/db";
import { chores, expenses, homeStatus, notes, notices, shoppingItems } from "@whome/db";
import { and, eq } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function coreRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/dashboard", async (c) => {
    if (!isModuleEnabled(env, "core")) {
      return c.json({ error: "core_disabled" }, 403);
    }
    const auth = c.get("auth")!;
    const [notice] = await db
      .select()
      .from(notices)
      .where(eq(notices.householdId, auth.householdId))
      .limit(1);
    const statuses = await db
      .select()
      .from(homeStatus)
      .where(eq(homeStatus.householdId, auth.householdId));
    return c.json({
      notice: notice?.content ?? "",
      noticeId: notice?.id ?? null,
      whosHome: statuses.map((s) => ({ id: s.id, name: s.name, status: s.status })),
    });
  });

  app.patch("/dashboard/notice", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ content: string }>();
    const [existing] = await db
      .select()
      .from(notices)
      .where(eq(notices.householdId, auth.householdId))
      .limit(1);
    if (existing) {
      await db
        .update(notices)
        .set({
          content: body.content ?? "",
          updatedByDisplayName: auth.email,
          updatedAt: new Date(),
        })
        .where(eq(notices.id, existing.id));
      return c.json({ ok: true, id: existing.id });
    }
    const [row] = await db
      .insert(notices)
      .values({
        householdId: auth.householdId,
        content: body.content ?? "",
        updatedByDisplayName: auth.email,
      })
      .returning();
    return c.json({ ok: true, id: row.id });
  });

  app.patch("/dashboard/home-status/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ status: string }>();
    await db
      .update(homeStatus)
      .set({ status: body.status ?? "Away", updatedAt: new Date() })
      .where(and(eq(homeStatus.id, id), eq(homeStatus.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/shopping", async (c) => {
    const auth = c.get("auth")!;
    const items = await db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.householdId, auth.householdId));
    return c.json({ items });
  });

  app.post("/shopping", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ item: string }>();
    const [row] = await db
      .insert(shoppingItems)
      .values({ householdId: auth.householdId, item: body.item })
      .returning();
    return c.json({ item: row }, 201);
  });

  app.patch("/shopping/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ checked?: boolean; item?: string }>();
    const patch: { checked?: boolean; item?: string } = {};
    if (body.checked !== undefined) patch.checked = body.checked;
    if (body.item !== undefined) patch.item = body.item;
    await db
      .update(shoppingItems)
      .set(patch)
      .where(and(eq(shoppingItems.id, id), eq(shoppingItems.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/chores", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(chores)
      .where(eq(chores.householdId, auth.householdId));
    return c.json({ chores: rows });
  });

  app.post("/chores", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ description: string; dueDate?: string }>();
    const [row] = await db
      .insert(chores)
      .values({
        householdId: auth.householdId,
        description: body.description,
        dueDate: body.dueDate ?? null,
        createdByDisplayName: auth.email,
      })
      .returning();
    return c.json({ chore: row }, 201);
  });

  app.patch("/chores/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ done?: boolean; description?: string }>();
    const patch: { done?: boolean; description?: string } = {};
    if (body.done !== undefined) patch.done = body.done;
    if (body.description !== undefined) patch.description = body.description;
    await db
      .update(chores)
      .set(patch)
      .where(and(eq(chores.id, id), eq(chores.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/notes", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(notes)
      .where(eq(notes.householdId, auth.householdId))
      .limit(50);
    return c.json({ notes: rows });
  });

  app.post("/notes", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ content: string }>();
    const [row] = await db
      .insert(notes)
      .values({
        householdId: auth.householdId,
        content: body.content,
        createdByDisplayName: auth.email,
      })
      .returning();
    return c.json({ note: row }, 201);
  });

  app.patch("/notes/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ content: string }>();
    await db
      .update(notes)
      .set({ content: body.content })
      .where(and(eq(notes.id, id), eq(notes.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.delete("/notes/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    await db
      .delete(notes)
      .where(and(eq(notes.id, id), eq(notes.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.householdId, auth.householdId))
      .limit(100);
    return c.json({ expenses: rows });
  });

  app.post("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title: string;
      amount: number;
      category?: string;
      expenseDate: string;
    }>();
    const [row] = await db
      .insert(expenses)
      .values({
        householdId: auth.householdId,
        title: body.title,
        amount: body.amount,
        category: body.category,
        expenseDate: body.expenseDate,
        createdByDisplayName: auth.email,
      })
      .returning();
    return c.json({ expense: row }, 201);
  });

  app.patch("/expenses/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      amount?: number;
      category?: string;
      expenseDate?: string;
    }>();
    await db
      .update(expenses)
      .set(body)
      .where(and(eq(expenses.id, id), eq(expenses.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  return app;
}
