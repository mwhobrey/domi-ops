import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
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

function sanitizeCards(parsed: unknown): string[] | null {
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) return null;
  const seen = new Set<string>();
  const cards: string[] = [];
  for (const id of parsed) {
    if (!KNOWN_CARD_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    cards.push(id);
  }
  return cards;
}

function sanitizeColumns(value: unknown): 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

function sanitizeSpans(raw: unknown): Record<string, 1 | 2 | 3> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, 1 | 2 | 3> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN_CARD_IDS.has(key)) continue;
    if (value === 1 || value === 2 || value === 3) out[key] = value;
  }
  return out;
}

function parseLayout(raw: string | null): {
  cards: string[];
  columns: 1 | 2 | 3;
  spans: Record<string, 1 | 2 | 3>;
} | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const cards = sanitizeCards(parsed);
      return cards ? { cards, columns: 2, spans: {} } : null;
    }
    if (parsed === null || typeof parsed !== "object") return null;
    const body = parsed as { cards?: unknown; columns?: unknown; spans?: unknown };
    const cards = sanitizeCards(body.cards);
    if (!cards) return null;
    return { cards, columns: sanitizeColumns(body.columns), spans: sanitizeSpans(body.spans) };
  } catch {
    return null;
  }
}

/**
 * Dashboard section-card order + grid (apps/web/src/components/DashboardBoard.tsx).
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
      .where(
        and(eq(householdMembers.id, auth.memberId), eq(householdMembers.householdId, auth.householdId)),
      )
      .limit(1);

    const layout = parseLayout(row?.dashboardLayout ?? null);
    if (!layout) return c.json({ cards: null, columns: 2, spans: {} });
    return c.json(layout);
  });

  app.patch("/", async (c) => {
    const auth = c.get("auth")!;
    let body: { cards?: unknown; columns?: unknown; spans?: unknown };
    try {
      const parsed: unknown = await c.req.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return c.json({ error: "invalid_cards" }, 400);
      }
      body = parsed as { cards?: unknown; columns?: unknown; spans?: unknown };
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    if (body.cards !== null && sanitizeCards(body.cards) === null) {
      return c.json({ error: "invalid_cards" }, 400);
    }

    let stored: string | null = null;
    if (body.cards !== null) {
      stored = JSON.stringify({
        cards: sanitizeCards(body.cards),
        columns: sanitizeColumns(body.columns),
        spans: sanitizeSpans(body.spans),
      });
    }

    await db
      .update(householdMembers)
      .set({ dashboardLayout: stored })
      .where(
        and(eq(householdMembers.id, auth.memberId), eq(householdMembers.householdId, auth.householdId)),
      );

    return c.json({ ok: true });
  });

  return app;
}
