import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers } from "@domi-ops/db";
import { requireAuth, type AppVariables } from "../middleware/auth.js";

const KNOWN_CARD_IDS = new Set([
  "glance",
  "agenda",
  "weather",
  "conflicts",
  "household",
  "month",
]);

function parseCards(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) return null;
    const seen = new Set<string>();
    const cards: string[] = [];
    for (const id of parsed) {
      if (!KNOWN_CARD_IDS.has(id) || seen.has(id)) continue;
      seen.add(id);
      cards.push(id);
    }
    return cards;
  } catch {
    return null;
  }
}

/**
 * Dashboard section-card order (apps/web/src/components/DashboardBoard.tsx).
 * Per-member, same reasoning as glance-config — different people care about different things.
 */
export function dashboardLayoutRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const [row] = await db
      .select({ dashboardLayout: householdMembers.dashboardLayout })
      .from(householdMembers)
      .where(eq(householdMembers.id, auth.memberId))
      .limit(1);

    return c.json({ cards: parseCards(row?.dashboardLayout ?? null) });
  });

  app.patch("/", async (c) => {
    const auth = c.get("auth")!;
    let body: { cards?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    if (body.cards !== null && !(Array.isArray(body.cards) && body.cards.every((t) => typeof t === "string"))) {
      return c.json({ error: "invalid_cards" }, 400);
    }

    let stored: string | null = null;
    if (body.cards !== null) {
      const seen = new Set<string>();
      const cards: string[] = [];
      for (const id of body.cards) {
        if (typeof id !== "string" || !KNOWN_CARD_IDS.has(id) || seen.has(id)) continue;
        seen.add(id);
        cards.push(id);
      }
      stored = JSON.stringify(cards);
    }

    await db
      .update(householdMembers)
      .set({ dashboardLayout: stored })
      .where(eq(householdMembers.id, auth.memberId));

    return c.json({ ok: true });
  });

  return app;
}
