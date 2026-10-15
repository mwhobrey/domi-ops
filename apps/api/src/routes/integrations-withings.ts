import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { withingsCredentials } from "@domi-ops/config";
import {
  WithingsError,
  encryptWithingsSecret,
  withingsExchangeCode,
  withingsScopeAllowsWorkouts,
  withingsSubscribe,
} from "@domi-ops/calendar-sync";
import { healthMedPushActionSecret, verifyWithingsWebhookToken } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import { getBaseDb, healthWithingsLinks, withHouseholdContext } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { hasHealthSegmentAccess, isHouseholdMember } from "../lib/health-access.js";
import { consumeOAuthState } from "../lib/oauth-state.js";
import { isUniqueViolationError } from "../lib/db-errors.js";
import {
  WITHINGS_OAUTH_PREFIX,
  withingsRedirectUri,
  withingsWebhookUrl,
  type WithingsOAuthState,
} from "../lib/withings.js";

/**
 * Withings' two entry points into Domi Ops (WHO-452). Paths are registered with each Withings app:
 *   GET  /api/integrations/withings/callback  OAuth redirect, needs the signed-in user's session
 *   POST /api/integrations/withings/webhook   new-data notification, authenticated by the signed `t` query
 */
export function integrationsWithingsRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  // Registered before requireAuth: Withings has no session. Withings checks a new subscription's URL
  // with a HEAD request (Hono serves HEAD from GET), and wants a 200.
  app.get("/webhook", (c) => c.text("ok"));

  /**
   * "Something changed for this user." Only flags the link; the worker does the pull. Always answers
   * quickly, and once the token checks out always with 200 so Withings does not retry-storm a link
   * that has since been removed or paused.
   */
  app.post("/webhook", async (c) => {
    const secret = healthMedPushActionSecret(env);
    const claims = secret ? verifyWithingsWebhookToken(c.req.query("t") ?? "", secret) : null;
    if (!claims) return c.json({ error: "invalid_token" }, 401);

    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const userid = typeof form.userid === "string" ? form.userid : "";

    // This endpoint has no session to carry a tenant, so it opens the household's own context.
    await withHouseholdContext(getBaseDb(db), claims.householdId, async (tx) => {
      const [link] = await tx
        .select({ id: healthWithingsLinks.id, withingsUserId: healthWithingsLinks.withingsUserId })
        .from(healthWithingsLinks)
        .where(
          and(
            eq(healthWithingsLinks.id, claims.linkId),
            eq(healthWithingsLinks.householdId, claims.householdId),
            eq(healthWithingsLinks.status, "active"),
          ),
        )
        .limit(1);
      // A call for a different Withings user than the one this link belongs to is not ours to act on.
      if (!link || (userid && userid !== link.withingsUserId)) return;
      await tx
        .update(healthWithingsLinks)
        .set({ syncRequestedAt: new Date() })
        .where(eq(healthWithingsLinks.id, link.id));
    });
    return c.json({ ok: true });
  });

  app.use("/callback", requireAuth(env));
  app.use("/callback", requireHouseholdModule(db, env, "health"));

  /**
   * Where Withings sends the browser after consent. The state is single use, and it has to belong to
   * the signed-in user who started it: otherwise anyone could be tricked into finishing someone
   * else's link, which would attach the wrong person's readings to a member.
   */
  app.get("/callback", async (c) => {
    const auth = c.get("auth")!;
    const back = (result: string) =>
      c.redirect(new URL(`/health?withings=${encodeURIComponent(result)}`, env.PUBLIC_APP_URL).toString());

    if (!withingsCredentials(env) || !env.REDIS_URL || !env.ENCRYPTION_KEY) return back("unavailable");
    if (c.req.query("error")) return back("denied");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return back("error");

    const saved = await consumeOAuthState<WithingsOAuthState>(env.REDIS_URL, WITHINGS_OAUTH_PREFIX, state);
    if (!saved) return back("expired");
    if (saved.userId !== auth.userId || saved.householdId !== auth.householdId) return back("error");

    // Rechecked: the state is minutes old, and permissions may have changed since.
    if (!(await isHouseholdMember(db, auth.householdId, saved.memberId))) return back("error");
    if (!(await hasHealthSegmentAccess(db, auth, saved.memberId, "events", "write"))) return back("forbidden");

    let tokens;
    try {
      tokens = await withingsExchangeCode(env, code, withingsRedirectUri(env));
    } catch (e) {
      if (!(e instanceof WithingsError)) throw e;
      return back("error");
    }

    const now = new Date();
    let link;
    try {
      [link] = await db
        .insert(healthWithingsLinks)
        .values({
          householdId: auth.householdId,
          memberId: saved.memberId,
          withingsUserId: tokens.userId,
          accessTokenEncrypted: encryptWithingsSecret(tokens.accessToken, env),
          refreshTokenEncrypted: encryptWithingsSecret(tokens.refreshToken, env),
          tokenExpiresAt: new Date(now.getTime() + tokens.expiresInSec * 1000),
          scope: tokens.scope,
          linkedByUserId: auth.userId,
          backfillFrom: new Date(now.getTime() - saved.backfillDays * 24 * 60 * 60 * 1000),
          // Pulled on the worker's next tick, history first.
          syncRequestedAt: now,
        })
        .returning();
    } catch (e) {
      if (isUniqueViolationError(e)) return back("already_linked");
      throw e;
    }

    // Best effort. Without a subscription the link still syncs, on the six-hour safety net instead of
    // within seconds, and "Sync now" works either way.
    try {
      const callback = withingsWebhookUrl(env, link!);
      if (callback) {
        await withingsSubscribe(tokens.accessToken, callback, undefined, {
          workouts: withingsScopeAllowsWorkouts(tokens.scope),
        });
      }
    } catch (e) {
      console.error("[withings] webhook subscribe failed", e instanceof Error ? e.message : e);
    }
    return back("connected");
  });

  return app;
}
