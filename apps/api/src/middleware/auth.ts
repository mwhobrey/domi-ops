import type { Context, Next } from "hono";
import { resolveAuthContext, type AuthContext, type WhomeBetterAuth } from "@whome/auth";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";

export type { AuthContext };

export type AppVariables = {
  auth: AuthContext | null;
  userId: string | null;
};

export function createAuthMiddleware(db: Database, env: Env, auth: WhomeBetterAuth) {
  return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const userId = session?.user?.id ?? null;
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
