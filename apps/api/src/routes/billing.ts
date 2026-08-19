import { Hono } from "hono";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { isHostedDeployment, isStripeConfigured, parseHouseholdModulesJson } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  households,
  householdSubscriptions,
  stripeEvents,
} from "@domi-ops/db";

const ALL_MODULES = JSON.stringify(["core", "school", "calendar_sync", "drive", "health"]);
const STARTER_QUOTA_BYTES = 26_843_545_600; // 25 GB

function makeStripe(secretKey: string) {
  return new Stripe(secretKey);
}

async function alreadyProcessed(db: Database, eventId: string): Promise<boolean> {
  const rows = await db.select().from(stripeEvents).where(eq(stripeEvents.id, eventId));
  return rows.length > 0;
}

async function markProcessed(db: Database, eventId: string, type: string): Promise<void> {
  await db.insert(stripeEvents).values({ id: eventId, type }).onConflictDoNothing();
}

async function upsertSubscription(
  db: Database,
  {
    householdId,
    stripeCustomerId,
    stripeSubscriptionId,
    status,
    trialEndsAt,
  }: {
    householdId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: "trialing" | "active" | "past_due" | "canceled";
    trialEndsAt: Date | null;
  },
): Promise<void> {
  await db
    .insert(householdSubscriptions)
    .values({
      householdId,
      modulesEntitled: ALL_MODULES,
      stripeCustomerId,
      stripeSubscriptionId,
      status,
      trialEndsAt,
    })
    .onConflictDoUpdate({
      target: householdSubscriptions.householdId,
      set: {
        stripeCustomerId,
        stripeSubscriptionId,
        status,
        trialEndsAt,
        updatedAt: new Date(),
      },
    });
}

/** Find or create a household for this Stripe customer. Returns householdId. */
async function resolveOrProvisionHousehold(
  db: Database,
  stripeCustomerId: string,
  customerEmail: string | null,
): Promise<string> {
  // Does a subscription row already exist for this customer?
  const existing = await db
    .select({ householdId: householdSubscriptions.householdId })
    .from(householdSubscriptions)
    .where(eq(householdSubscriptions.stripeCustomerId, stripeCustomerId));

  if (existing.length > 0) {
    return existing[0].householdId;
  }

  // No household yet — provision one. Name derived from customer email prefix.
  const name = customerEmail
    ? customerEmail.split("@")[0].replace(/[^a-zA-Z0-9 ]/g, " ").trim() || "My Household"
    : "My Household";

  const [household] = await db
    .insert(households)
    .values({
      name,
      tier: "hosted_starter",
      timezone: "UTC",
      modulesEnabled: ALL_MODULES,
      storageQuotaBytes: STARTER_QUOTA_BYTES,
    })
    .returning({ id: households.id });

  return household.id;
}

export function billingRoutes(db: Database, env: Env) {
  const app = new Hono();

  // Only available on hosted deployments with Stripe configured.
  app.post("/webhook", async (c) => {
    if (!isHostedDeployment(env) || !isStripeConfigured(env)) {
      return c.json({ error: "not_found" }, 404);
    }

    const stripe = makeStripe(env.STRIPE_SECRET_KEY!);
    const sig = c.req.header("stripe-signature");
    if (!sig) {
      return c.json({ error: "missing_signature" }, 400);
    }

    const rawBody = await c.req.text();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET!);
    } catch {
      return c.json({ error: "invalid_signature" }, 400);
    }

    // Idempotency — Stripe retries on non-2xx.
    if (await alreadyProcessed(db, event.id)) {
      return c.json({ ok: true, skipped: true });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode !== "subscription" || !session.subscription || !session.customer) break;

          const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
          const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;

          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
          const status = sub.status === "trialing" ? "trialing" : sub.status === "active" ? "active" : "trialing";

          const householdId = await resolveOrProvisionHousehold(db, customerId, session.customer_email);

          await upsertSubscription(db, {
            householdId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            status,
            trialEndsAt: trialEnd,
          });

          // Stamp the household storage quota and tier.
          await db
            .update(households)
            .set({ tier: "hosted_starter", storageQuotaBytes: STARTER_QUOTA_BYTES, updatedAt: new Date() })
            .where(eq(households.id, householdId));

          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

          const existing = await db
            .select({ householdId: householdSubscriptions.householdId })
            .from(householdSubscriptions)
            .where(eq(householdSubscriptions.stripeCustomerId, customerId));

          if (existing.length === 0) break;

          const stripeStatus = sub.status;
          const mapped =
            stripeStatus === "trialing" ? "trialing"
            : stripeStatus === "active" ? "active"
            : stripeStatus === "past_due" ? "past_due"
            : "canceled";

          await db
            .update(householdSubscriptions)
            .set({
              status: mapped,
              trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
              stripeSubscriptionId: sub.id,
              updatedAt: new Date(),
            })
            .where(eq(householdSubscriptions.stripeCustomerId, customerId));

          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

          await db
            .update(householdSubscriptions)
            .set({ status: "canceled", updatedAt: new Date() })
            .where(eq(householdSubscriptions.stripeCustomerId, customerId));

          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
          if (!customerId) break;

          await db
            .update(householdSubscriptions)
            .set({ status: "past_due", updatedAt: new Date() })
            .where(eq(householdSubscriptions.stripeCustomerId, customerId));

          break;
        }

        default:
          break;
      }

      await markProcessed(db, event.id, event.type);
      return c.json({ ok: true });
    } catch (err) {
      console.error("[billing] webhook handler error:", err);
      return c.json({ error: "handler_error" }, 500);
    }
  });

  return app;
}
