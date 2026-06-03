import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import {
  getSessionUserId,
  resolveAuthContext,
  SESSION_COOKIE,
  type AuthContext,
} from "@whome/auth";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";

export type AppVariables = {
  auth: AuthContext | null;
  userId: string | null;
};

export function createAuthMiddleware(db: Database, env: Env) {
  return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
    const secret = env.SESSION_SECRET;
    if (!secret) {
      c.set("auth", null);
      c.set("userId", null);
      return next();
    }
    const cookie = getCookie(c, SESSION_COOKIE);
    const userId = await getSessionUserId(db, cookie, secret);
    c.set("userId", userId);
    if (userId) {
      const ctx = await resolveAuthContext(db, userId);
      c.set("auth", ctx);
    } else {
      c.set("auth", null);
    }
    return next();
  };
}

export function requireAuth(env: Env) {
  return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
    if (!env.AUTH_REQUIRED && env.NODE_ENV === "development") {
      return next();
    }
    const auth = c.get("auth");
    if (!auth) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  };
}
