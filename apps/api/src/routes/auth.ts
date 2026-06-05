import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "@whome/config";
import {
  resolveLoginUserAndHousehold,
  resolveAuthContext,
  createSession,
  destroySession,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  googleAuthUrl,
  googleOAuthRedirectUri,
  GOOGLE_LOGIN_SCOPES,
  randomOAuthState,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@whome/auth";
import type { Database } from "@whome/db";
import { householdMembers } from "@whome/db";
import { eq } from "drizzle-orm";
import { memberAvatarUrl } from "../lib/avatar-url.js";
import type { AppVariables } from "../middleware/auth.js";
import { consumeOAuthState, setOAuthState } from "../lib/oauth-state.js";

const LOGIN_OAUTH_PREFIX = "oauth:login";

function redisUrl(env: Env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

export function authRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/session", async (c) => {
    const secret = env.SESSION_SECRET;
    let auth = c.get("auth");
    const userId = c.get("userId");

    if (!auth && userId && secret) {
      auth = await resolveAuthContext(db, userId);
    }

    if (!auth) return c.json({ authenticated: false });

    const [memberRow] = await db
      .select({ avatarKey: householdMembers.avatarKey })
      .from(householdMembers)
      .where(eq(householdMembers.id, auth.memberId))
      .limit(1);

    return c.json({
      authenticated: true,
      user: {
        id: auth.userId,
        email: auth.email,
        householdId: auth.householdId,
        memberId: auth.memberId,
        name: auth.name,
        nickname: auth.nickname,
        publicLabel: auth.publicLabel,
        role: auth.role,
        avatarUrl: memberAvatarUrl(auth.memberId, memberRow?.avatarKey),
      },
    });
  });

  app.get("/google/login", async (c) => {
    if (!env.GOOGLE_OAUTH_CLIENT_ID) {
      return c.json({ error: "google_oauth_not_configured" }, 503);
    }
    const state = randomOAuthState();
    const next = c.req.query("next");
    const returnTo = next?.startsWith("/") ? next : undefined;
    await setOAuthState(redisUrl(env), LOGIN_OAUTH_PREFIX, state, {
      kind: "login" as const,
      returnTo,
    });
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
    const pending = state
      ? await consumeOAuthState<{ kind: "login"; returnTo?: string }>(
          redisUrl(env),
          LOGIN_OAUTH_PREFIX,
          state,
        )
      : null;
    if (!code || !pending) {
      return c.redirect(`${env.PUBLIC_APP_URL}/login?error=oauth`);
    }

    try {
      const redirectUri = googleOAuthRedirectUri(env, "/auth/google/login/callback");
      const tokens = await exchangeGoogleCode(env, code, redirectUri);
      const profile = await fetchGoogleUserInfo(tokens.access_token);
      const { userId } = await resolveLoginUserAndHousehold(db, env, {
        email: profile.email,
        displayName: profile.name,
        imageUrl: profile.picture,
        emailVerified: profile.email_verified,
      });
      const { cookie } = await createSession(db, userId, secret);
      setCookie(c, SESSION_COOKIE, cookie, sessionCookieOptions(env));
      return c.redirect(`${env.PUBLIC_APP_URL}${pending.returnTo ?? "/dashboard"}`);
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
