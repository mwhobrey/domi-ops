import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers } from "@domi-ops/db";
import { requireAuth, type AppVariables } from "../middleware/auth.js";

/**
 * Dashboard "Today at a glance" tile visibility + order (apps/web/src/components/TodayGlance.tsx).
 * Per-member, same reasoning as onboarding.ts — different people in the same household
 * reasonably care about different things, so this isn't a household-wide setting.
 */
export function glanceConfigRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const [row] = await db
      .select({ glanceConfig: householdMembers.glanceConfig })
      .from(householdMembers)
      .where(eq(householdMembers.id, auth.memberId))
      .limit(1);

    let tiles: string[] | null = null;
    try {
      tiles = row?.glanceConfig ? (JSON.parse(row.glanceConfig) as string[]) : null;
    } catch {
      tiles = null;
    }

    return c.json({ tiles });
  });

  app.patch("/", async (c) => {
    const auth = c.get("auth")!;
    let body: { tiles?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    // tiles: null resets to default (all available, urgency-sorted) — an empty array is a
    // deliberate "hide everything", distinct from "no preference set".
    if (body.tiles !== null && !(Array.isArray(body.tiles) && body.tiles.every((t) => typeof t === "string"))) {
      return c.json({ error: "invalid_tiles" }, 400);
    }

    await db
      .update(householdMembers)
      .set({ glanceConfig: body.tiles === null ? null : JSON.stringify(body.tiles) })
      .where(eq(householdMembers.id, auth.memberId));

    return c.json({ ok: true });
  });

  return app;
}
