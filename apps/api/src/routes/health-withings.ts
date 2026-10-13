import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { withingsCredentials } from "@domi-ops/config";
import {
  withingsAuthorizeUrl,
  withingsCurrentAccessToken,
  withingsUnsubscribe,
} from "@domi-ops/calendar-sync";
import type { Database } from "@domi-ops/db";
import { healthWithingsLinks } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { hasHealthSegmentAccess, isHouseholdMember, loadHealthCapabilities } from "../lib/health-access.js";
import { setOAuthState } from "../lib/oauth-state.js";
import {
  WITHINGS_OAUTH_PREFIX,
  normalizeBackfillDays,
  serializeWithingsLink,
  withingsRedirectUri,
  withingsWebhookUrl,
  type WithingsOAuthState,
} from "../lib/withings.js";

/**
 * Withings blood pressure sync, the signed-in half (WHO-452). Who may link, sync or unlink a cuff
 * is who may write that person's health entries, exactly like scheduled checks: the person
 * themselves, or anyone granted `events: write` on them. The OAuth callback and the webhook live in
 * integrations-withings.ts.
 */
export function healthWithingsRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  const enabled = () => withingsCredentials(env) != null;

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ enabled: false, links: [] });

    const rows = await db
      .select()
      .from(healthWithingsLinks)
      .where(eq(healthWithingsLinks.householdId, auth.householdId));
    // One lookup for everyone, not one per link: the panel re-reads this every few seconds while a
    // link is importing. These members all come from the caller's own household.
    const caps = await loadHealthCapabilities(
      db,
      auth,
      rows.map((r) => r.memberId),
    );
    const links = rows.filter((r) => caps[r.memberId]?.events !== "none").map(serializeWithingsLink);
    return c.json({ enabled: true, links });
  });

  /** Start linking: returns the Withings consent URL for the browser to go to. */
  app.post("/links/:memberId/connect", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ error: "not_available" }, 404);

    const memberId = c.req.param("memberId");
    if (!(await isHouseholdMember(db, auth.householdId, memberId))) {
      return c.json({ error: "member_not_found" }, 404);
    }
    if (!(await hasHealthSegmentAccess(db, auth, memberId, "events", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [existing] = await db
      .select({ id: healthWithingsLinks.id })
      .from(healthWithingsLinks)
      .where(eq(healthWithingsLinks.memberId, memberId))
      .limit(1);
    if (existing) return c.json({ error: "already_linked" }, 409);

    // Server config is only worth reporting to someone who is allowed to link.
    if (!env.ENCRYPTION_KEY) return c.json({ error: "encryption_key_required" }, 503);
    if (!env.REDIS_URL) return c.json({ error: "redis_required" }, 503);

    const body = await c.req.json<{ backfillDays?: unknown }>().catch(() => ({}) as { backfillDays?: unknown });
    const state = randomBytes(24).toString("hex");
    const payload: WithingsOAuthState = {
      userId: auth.userId,
      householdId: auth.householdId,
      memberId,
      backfillDays: normalizeBackfillDays(body.backfillDays),
    };
    await setOAuthState(env.REDIS_URL, WITHINGS_OAUTH_PREFIX, state, payload);
    return c.json({ authorizeUrl: withingsAuthorizeUrl(env, { redirectUri: withingsRedirectUri(env), state }) });
  });

  /** "Sync now": also the way out of `error` once the cause is fixed. A revoked link has to be re-linked. */
  app.post("/links/:memberId/sync", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ error: "not_available" }, 404);
    const memberId = c.req.param("memberId");
    if (!(await hasHealthSegmentAccess(db, auth, memberId, "events", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .update(healthWithingsLinks)
      .set({
        status: "active",
        lastError: null,
        attempts: 0,
        nextAttemptAt: null,
        syncRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(healthWithingsLinks.memberId, memberId),
          eq(healthWithingsLinks.householdId, auth.householdId),
          inArray(healthWithingsLinks.status, ["active", "error"]),
        ),
      )
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ link: serializeWithingsLink(row) });
  });

  /**
   * Pull history again over a new window. Safe to repeat: readings already imported, and ones the
   * user deleted since, are recognised by their Withings group id and not brought back.
   */
  app.post("/links/:memberId/backfill", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ error: "not_available" }, 404);
    const memberId = c.req.param("memberId");
    if (!(await hasHealthSegmentAccess(db, auth, memberId, "events", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{ days?: unknown }>().catch(() => ({}) as { days?: unknown });
    const now = new Date();
    const days = normalizeBackfillDays(body.days);
    const [row] = await db
      .update(healthWithingsLinks)
      .set({
        status: "active",
        backfillFrom: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
        backfillDoneAt: null,
        lastUpdate: null,
        lastError: null,
        attempts: 0,
        nextAttemptAt: null,
        syncRequestedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(healthWithingsLinks.memberId, memberId),
          eq(healthWithingsLinks.householdId, auth.householdId),
          inArray(healthWithingsLinks.status, ["active", "error"]),
        ),
      )
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ link: serializeWithingsLink(row) });
  });

  /** Unlink. Readings already imported stay: they are the person's health history now. */
  app.delete("/links/:memberId", async (c) => {
    const auth = c.get("auth")!;
    if (!enabled()) return c.json({ error: "not_available" }, 404);
    const memberId = c.req.param("memberId");
    if (!(await hasHealthSegmentAccess(db, auth, memberId, "events", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .select()
      .from(healthWithingsLinks)
      .where(and(eq(healthWithingsLinks.memberId, memberId), eq(healthWithingsLinks.householdId, auth.householdId)))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);

    // Best effort: if Withings is down we still drop our side, and the webhook token stops meaning
    // anything the moment the link row is gone. The access token is refreshed first when needed:
    // they last about three hours, so the stored one is usually stale by the time someone unlinks.
    let unsubscribed = true;
    try {
      const callback = withingsWebhookUrl(env, row);
      if (!callback) throw new Error("no webhook secret");
      await withingsUnsubscribe(await withingsCurrentAccessToken(env, row), callback);
    } catch {
      unsubscribed = false;
    }
    await db.delete(healthWithingsLinks).where(eq(healthWithingsLinks.id, row.id));
    return c.json({ ok: true, unsubscribedRemotely: unsubscribed });
  });

  return app;
}
