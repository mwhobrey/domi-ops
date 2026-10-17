import { Hono } from "hono";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { isHostedDeployment } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers, householdSubscriptions, stripeEvents, users, withSystemContext } from "@domi-ops/db";
import { resolveOrProvisionHousehold, upsertSubscription } from "./billing.js";

type RevenueCatEvent = {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  store?: string;
  id?: string;
  original_transaction_id?: string;
  event_timestamp_ms?: number;
  period_type?: string;
  entitlement_ids?: string[];
  environment?: string;
  app_id?: string;
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
    if (type === "TEST") return c.json({ ok: true, test: true });
    const supported = ["INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", "UNCANCELLATION", "BILLING_ISSUE", "EXPIRATION", "SUBSCRIPTION_EXTENDED", "PRODUCT_CHANGE"];
    if (!supported.includes(type)) return c.json({ ok: true, ignored: true });
    const allowedProducts = env.REVENUECAT_ALLOWED_PRODUCT_IDS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const allowedApps = env.REVENUECAT_ALLOWED_APP_IDS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    if (!allowedProducts.length || !allowedApps.length) return c.json({ error: "revenuecat_allowlist_not_configured" }, 503);
    if (!allowedProducts.includes(event.product_id ?? "") || !allowedApps.includes(event.app_id ?? "") ||
        event.environment !== (env.REVENUECAT_ENVIRONMENT ?? "PRODUCTION") ||
        !event.entitlement_ids?.includes(env.REVENUECAT_ENTITLEMENT_ID ?? "starter")) {
      return c.json({ ok: true, ignored: true });
    }
    if (!event.id || event.id.length > 200 || !event.original_transaction_id || event.original_transaction_id.length > 160 ||
        !["APP_STORE", "PLAY_STORE", "AMAZON"].includes(event.store ?? "") ||
        !Number.isSafeInteger(event.event_timestamp_ms) || !Number.isSafeInteger(event.expiration_at_ms) ||
        event.event_timestamp_ms! <= 0 || event.expiration_at_ms! <= 0 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return c.json({ error: "invalid_event" }, 400);
    }
    const sourceUpdatedAt = new Date(event.event_timestamp_ms!);
    const currentPeriodEnd = new Date(event.expiration_at_ms!);
    const status = type === "EXPIRATION" ? "canceled" as const
      : type === "BILLING_ISSUE" ? "past_due" as const
      : currentPeriodEnd.getTime() <= Date.now() ? "canceled" as const
      : event.period_type === "TRIAL" ? "trialing" as const : "active" as const;

    const result = await withSystemContext(db, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:owner:${userId}`}, 0))`);
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return "unknown_user";
      const receiptId = `rc:${event.id}`;
      const [seen] = await tx.select().from(stripeEvents).where(eq(stripeEvents.id, receiptId));
      if (seen) return "ok";
      const [membership] = await tx
        .select({ householdId: householdMembers.householdId, role: householdMembers.role })
        .from(householdMembers)
        .where(and(eq(householdMembers.userId, userId), isNull(householdMembers.accessRevokedAt)))
        .limit(1);
      if (membership && membership.role !== "owner") return "owner_required";
      if (!membership && !["INITIAL_PURCHASE", "RENEWAL"].includes(type)) return "household_required";
      const customerId = `rc:${userId}`;
      const householdId = membership?.householdId ?? await resolveOrProvisionHousehold(tx, customerId, user.email, userId);
      const [existing] = await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, householdId)).for("update");
      if (existing?.provider === "stripe" && existing.status !== "canceled") return "billing_provider_conflict";
      if (existing?.sourceUpdatedAt && existing.provider === "revenuecat" &&
          (existing.sourceUpdatedAt > sourceUpdatedAt || (existing.sourceUpdatedAt.getTime() === sourceUpdatedAt.getTime() && existing.status === "canceled" && status !== "canceled"))) return "stale";
      const subscriptionId = `rc_sub:v2:${event.store}:${event.original_transaction_id}`;
      if (existing?.provider === "revenuecat" && existing.stripeCustomerId === customerId &&
          existing.stripeSubscriptionId?.startsWith("rc_sub:") && !existing.stripeSubscriptionId.startsWith("rc_sub:v2:")) {
        // One-time adoption of event-id based legacy identities for this verified store owner.
        await tx.update(householdSubscriptions).set({ stripeSubscriptionId: subscriptionId }).where(eq(householdSubscriptions.id, existing.id));
      }
      const accepted = await upsertSubscription(tx, {
        householdId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status,
        trialEndsAt: status === "trialing" ? currentPeriodEnd : null,
        currentPeriodEnd, cancelAtPeriodEnd: type === "CANCELLATION" ? true
          : ["UNCANCELLATION", "RENEWAL"].includes(type) ? false : existing?.cancelAtPeriodEnd ?? false,
        provider: "revenuecat", sourceUpdatedAt,
        pastDueSince: status === "past_due" ? (existing?.status === "past_due" ? existing.pastDueSince ?? sourceUpdatedAt : sourceUpdatedAt) : null,
      });
      if (!accepted) return "billing_provider_conflict";
      if (!membership) await tx.insert(householdMembers).values({ householdId, userId, role: "owner" });
      await tx.insert(stripeEvents).values({ id: receiptId, type: `revenuecat.${type}` }).onConflictDoNothing();
      return "ok";
    });
    if (["billing_provider_conflict", "owner_required", "household_required"].includes(result)) return c.json({ error: result, message: "The store purchase needs billing reconciliation. Contact support." }, 409);
    return c.json({ ok: true, ignored: result !== "ok" });
  });

  return app;
}
