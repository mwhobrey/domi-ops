import type { Context, Next } from "hono";
import { isHostedDeployment, subscriptionAllowsWork, type Env } from "@domi-ops/config";
import { householdSubscriptions, type Database } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import type { AppVariables } from "./auth.js";

export function createSubscriptionMiddleware(db: Database, env: Env) {
  return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
    const auth = c.get("auth");
    if (!auth || !isHostedDeployment(env) || ["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    const path = c.req.path;
    // Billing recovery, personal account controls, export, and feedback must work
    // even when the subscription no longer permits product mutations.
    if (path.startsWith("/api/billing/") || path.startsWith("/api/invitations/") || path.startsWith("/api/core/profile") || path.startsWith("/api/core/household/export") || path.startsWith("/api/feedback")) return next();
    if (c.req.method === "POST" && ["/api/core/reports/export", "/api/core/weekly-reports/export"].includes(path)) {
      const body = await c.req.json<{ destination?: string }>().catch(() => null);
      if (body && (!body.destination || body.destination === "preview")) return next();
    }
    if (c.req.method === "PATCH" && path === "/api/core/household/settings") {
      const body = await c.req.json<Record<string, unknown>>().catch(() => null);
      if (body && Object.keys(body).length === 1 && typeof body.telemetryOptIn === "boolean") return next();
    }
    const [subscription] = await db.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, auth.householdId)).limit(1);
    if (!subscriptionAllowsWork(subscription ?? null)) return c.json({
      error: "subscription_read_only",
      message: "Your household is in read-only mode. You can read and export your data. The owner can manage the subscription in Settings.",
    }, 402);
    return next();
  };
}
