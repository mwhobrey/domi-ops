import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  hasSetupAccess,
  isSetupTokenConfigured,
  needsGreenfieldSetup,
  SETUP_GRANT_COOKIE,
  signSetupGrant,
  verifySetupToken,
} from "@domi-ops/auth";

export function setupRoutes(db: Database, env: Env) {
  const app = new Hono();

  app.get("/status", async (c) => {
    const needsSetup = await needsGreenfieldSetup(db, env);
    return c.json({
      needsSetup,
      setupTokenConfigured: isSetupTokenConfigured(env),
      allowPublicSignup: Boolean(env.ALLOW_PUBLIC_SIGNUP),
      demoMode: Boolean(env.DEMO_MODE),
    });
  });

  app.post("/unlock", async (c) => {
    const needsSetup = await needsGreenfieldSetup(db, env);
    if (!needsSetup) {
      return c.json({ message: "Household already exists" }, 409);
    }
    if (!isSetupTokenConfigured(env)) {
      return c.json({ message: "SETUP_TOKEN is not configured on this server" }, 503);
    }

    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const token = body.token?.trim() ?? c.req.header("x-setup-token")?.trim();
    if (!verifySetupToken(env, token)) {
      return c.json({ message: "Invalid setup token" }, 403);
    }

    const secret = env.SESSION_SECRET;
    if (!secret) {
      return c.json({ message: "SESSION_SECRET is required for setup unlock" }, 500);
    }

    setCookie(c, SETUP_GRANT_COOKIE, signSetupGrant(secret), {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 60,
    });

    return c.json({ ok: true });
  });

  app.get("/access", async (c) => {
    const needsSetup = await needsGreenfieldSetup(db, env);
    const grantCookie = getCookie(c, SETUP_GRANT_COOKIE);
    const headerToken = c.req.header("x-setup-token");
    return c.json({
      needsSetup,
      hasAccess: !needsSetup || hasSetupAccess(env, { headerToken, grantCookie }),
    });
  });

  return app;
}
