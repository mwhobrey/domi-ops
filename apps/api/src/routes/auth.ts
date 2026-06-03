import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "@whome/config";
import {
  bootstrapHouseholdOnLogin,
  resolveAuthContext,
  createSession,
  destroySession,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  findOrCreateUser,
  googleAuthUrl,
  googleOAuthRedirectUri,
  GOOGLE_LOGIN_SCOPES,
  randomOAuthState,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@whome/auth";
import type { Database } from "@whome/db";
import type { AppVariables } from "../middleware/auth.js";

const oauthStates = new Map<string, { created: number; kind: "login" }>();

function pruneStates() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of oauthStates) {
    if (v.created < cutoff) oauthStates.delete(k);
  }
}

export function authRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/session", async (c) => {
    const secret = env.SESSION_SECRET;
    let auth = c.get("auth");
    const userId = c.get("userId");

    if (!auth && userId && secret) {
      try {
        await bootstrapHouseholdOnLogin(db, env, userId);
        auth = await resolveAuthContext(db, userId);
      } catch (e) {
        console.error("session bootstrap failed", e);
      }
    }

    if (!auth) return c.json({ authenticated: false });
    return c.json({
      authenticated: true,
      user: {
        id: auth.userId,
        email: auth.email,
        householdId: auth.householdId,
        role: auth.role,
      },
    });
  });

  app.get("/google/login", (c) => {
    if (!env.GOOGLE_OAUTH_CLIENT_ID) {
      return c.json({ error: "google_oauth_not_configured" }, 503);
    }
    pruneStates();
    const state = randomOAuthState();
    oauthStates.set(state, { created: Date.now(), kind: "login" });
    const redirectUri = googleOAuthRedirectUri(env, "/auth/google/login/callback");
    const url = googleAuthUrl(env, {
      redirectUri,
      scopes: GOOGLE_LOGIN_SCOPES,
      state,
      prompt: "select_account",
    });
    return c.redirect(url);
  });

  app.get("/google/login/callback", async (c) => {
    const secret = env.SESSION_SECRET;
    if (!secret) return c.json({ error: "session_not_configured" }, 503);

    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state || !oauthStates.has(state)) {
      return c.redirect(`${env.PUBLIC_APP_URL}/login?error=oauth`);
    }
    oauthStates.delete(state);

    try {
      const redirectUri = googleOAuthRedirectUri(env, "/auth/google/login/callback");
      const tokens = await exchangeGoogleCode(env, code, redirectUri);
      const profile = await fetchGoogleUserInfo(tokens.access_token);
      const user = await findOrCreateUser(db, {
        email: profile.email,
        displayName: profile.name,
        imageUrl: profile.picture,
        emailVerified: profile.email_verified,
      });
      await bootstrapHouseholdOnLogin(db, env, user.id);
      const { cookie } = await createSession(db, user.id, secret);
      setCookie(c, SESSION_COOKIE, cookie, sessionCookieOptions(env));
      return c.redirect(`${env.PUBLIC_APP_URL}/dashboard`);
    } catch (e) {
      console.error("login callback failed", e);
      return c.redirect(`${env.PUBLIC_APP_URL}/login?error=oauth`);
    }
  });

  app.post("/logout", async (c) => {
    const secret = env.SESSION_SECRET;
    if (secret) {
      await destroySession(db, getCookie(c, SESSION_COOKIE), secret);
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  return app;
}
