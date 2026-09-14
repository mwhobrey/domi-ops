import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { isHostedDeployment } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers, withSystemContext } from "@domi-ops/db";
import { upsertSubscription } from "./billing.js";

type RevenueCatEvent = {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  store?: string;
  id?: string;
};

/**
 * RevenueCat → household_subscriptions (WHO-290 / ADR 005).
 *
 * Web keeps Stripe. Native store builds purchase via RevenueCat; this webhook is the
 * grant adapter into the same subscription row Stripe writes. app_user_id MUST be the
 * Domi Ops `users.id` (configure RC with that as app user id from the Capacitor client).
 */
export function revenueCatRoutes(db: Database, env: Env) {
  const app = new Hono();

  app.post("/revenuecat/webhook", async (c) => {
    if (!isHostedDeployment(env)) {
      return c.json({ error: "not_hosted" }, 404);
    }
    const secret = env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret) {
      return c.json({ error: "revenuecat_not_configured" }, 503);
    }

    const authHeader = c.req.header("Authorization") ?? "";
    if (authHeader !== `Bearer ${secret}`) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = await c.req.json<{ event?: RevenueCatEvent }>().catch(() => null);
    const event = body?.event;
    if (!event?.type || !event.app_user_id) {
      return c.json({ error: "invalid_event" }, 400);
    }

    const userId = event.app_user_id;
    const type = event.type.toUpperCase();

    const status =
      type === "CANCELLATION" || type === "EXPIRATION"
        ? ("canceled" as const)
        : type === "BILLING_ISSUE"
          ? ("past_due" as const)
          : type.includes("TRIAL")
            ? ("trialing" as const)
            : ("active" as const);

    await withSystemContext(db, async (tx) => {
      const [membership] = await tx
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(eq(householdMembers.userId, userId))
        .limit(1);
      if (!membership) {
        console.warn("[domi-ops revenuecat] no household for app_user_id", userId, type);
        return;
      }

      const customerId = `rc:${userId}`;
      const subscriptionId = event.id
        ? `rc_sub:${event.id}`
        : `rc_sub:${userId}:${event.product_id ?? "starter"}`;
      const trialEndsAt =
        status === "trialing" && event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;

      await upsertSubscription(tx as Database, {
        householdId: membership.householdId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status,
        trialEndsAt,
      });
    });

    return c.json({ ok: true });
  });

  return app;
}
