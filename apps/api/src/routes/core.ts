import { Hono } from "hono";
import type { Env } from "@whome/config";
import { isModuleEnabled } from "@whome/config";
import type { Database } from "@whome/db";
import { chores, expenses, homeStatus, notes, notices, shoppingItems } from "@whome/db";
import { eq } from "drizzle-orm";
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
      whosHome: statuses.map((s) => ({ name: s.name, status: s.status })),
    });
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
    const body = await c.req.json<{ checked?: boolean }>();
    await db
      .update(shoppingItems)
      .set({ checked: body.checked ?? false })
      .where(eq(shoppingItems.id, id));
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
    const body = await c.req.json<{ description: string }>();
    const [row] = await db
      .insert(chores)
      .values({ householdId: auth.householdId, description: body.description })
      .returning();
    return c.json({ chore: row }, 201);
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

  app.get("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.householdId, auth.householdId))
      .limit(100);
    return c.json({ expenses: rows });
  });

  return app;
}
