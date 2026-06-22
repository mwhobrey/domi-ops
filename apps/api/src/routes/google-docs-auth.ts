import { Hono } from "hono";
import {
  exchangeGoogleCode,
  googleAuthUrl,
  googleOAuthRedirectUri,
  GOOGLE_DOCS_SCOPES,
  randomOAuthState,
} from "@whome/auth";
import type { Env } from "@whome/config";
import { encryptSensitive } from "@whome/crypto";
import type { Database } from "@whome/db";
import { googleDocsConnections } from "@whome/db";
import { and, eq } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { consumeOAuthState, setOAuthState } from "../lib/oauth-state.js";

const DOCS_OAUTH_PREFIX = "oauth:google-docs";

function redisUrl(env: Env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

export function googleDocsAuthRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/start", async (c) => {
    const auth = c.get("auth");
    if (!auth) {
      const next = encodeURIComponent("/auth/google/docs/start");
      return c.redirect(`${env.PUBLIC_APP_URL}/login?next=${next}`);
    }
    if (!env.GOOGLE_OAUTH_CLIENT_ID) {
      return c.json({ error: "google_oauth_not_configured" }, 503);
    }

    const state = randomOAuthState();
    await setOAuthState(redisUrl(env), DOCS_OAUTH_PREFIX, state, {
      userId: auth.userId,
      householdId: auth.householdId,
    });

    const redirectUri = googleOAuthRedirectUri(env, "/auth/google/docs/callback");
    const url = googleAuthUrl(env, {
      redirectUri,
      scopes: GOOGLE_DOCS_SCOPES,
      state,
      accessType: "offline",
      prompt: "consent",
    });
    return c.redirect(url);
  });

  app.get("/callback", async (c) => {
    const encKey = env.ENCRYPTION_KEY;
    if (!encKey) return c.json({ error: "encryption_key_required" }, 503);

    const code = c.req.query("code");
    const state = c.req.query("state");
    const pending = state
      ? await consumeOAuthState<{ userId: string; householdId: string }>(
          redisUrl(env),
          DOCS_OAUTH_PREFIX,
          state,
        )
      : null;
    if (!code || !pending) {
      return c.redirect(`${env.PUBLIC_APP_URL}/profile?error=google_docs_oauth`);
    }

    const redirectUri = googleOAuthRedirectUri(env, "/auth/google/docs/callback");
    try {
      const tokens = await exchangeGoogleCode(env, code, redirectUri);
      if (!tokens.refresh_token) {
        return c.redirect(`${env.PUBLIC_APP_URL}/profile?error=google_docs_no_refresh`);
      }

      const refreshEnc = encryptSensitive(tokens.refresh_token, encKey);
      const accessEnc = tokens.access_token ? encryptSensitive(tokens.access_token, encKey) : null;
      const tokenExpiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

      const [existing] = await db
        .select()
        .from(googleDocsConnections)
        .where(
          and(
            eq(googleDocsConnections.userId, pending.userId),
            eq(googleDocsConnections.householdId, pending.householdId),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(googleDocsConnections)
          .set({ refreshTokenEnc: refreshEnc, accessTokenEnc: accessEnc, tokenExpiry })
          .where(eq(googleDocsConnections.id, existing.id));
      } else {
        await db.insert(googleDocsConnections).values({
          householdId: pending.householdId,
          userId: pending.userId,
          refreshTokenEnc: refreshEnc,
          accessTokenEnc: accessEnc,
          tokenExpiry,
        });
      }

      return c.redirect(`${env.PUBLIC_APP_URL}/profile?google_docs_connected=1`);
    } catch (e) {
      console.error("google docs oauth callback", e);
      return c.redirect(`${env.PUBLIC_APP_URL}/profile?error=google_docs_oauth`);
    }
  });

  return app;
}
