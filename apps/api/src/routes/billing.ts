import { Hono } from "hono";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { isHostedDeployment, isStripeConfigured } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  baAccounts,
  households,
  householdMembers,
  householdSubscriptions,
  stripeEvents,
  users,
  withSystemContext,
} from "@domi-ops/db";
import { hashPassword } from "@domi-ops/auth";

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

/**
 * These three helpers all touch `households` / `household_subscriptions` before any
 * `householdId` is known to the caller (looked up by Stripe customer id instead) — on hosted,
 * that means RLS's normal `household_isolation` policy can never pass (there's no tenant
 * context to set yet). Callers MUST run them inside `withSystemContext` (matches the
 * `system_bootstrap` policy on all three tables — households/household_members from 0039,
 * household_subscriptions from 0056). Self-host isn't RLS-enforced so this is a no-op there.
 */

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
      // See the comment above resolveOrProvisionHousehold — none of these rows have a
      // household_id context yet, so every write here needs the system_bootstrap RLS policy.
      await withSystemContext(db, async (tx) => {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            if (session.mode !== "subscription" || !session.subscription || !session.customer) break;

            const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
            const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;

            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
            const status = sub.status === "trialing" ? "trialing" : sub.status === "active" ? "active" : "trialing";

            const householdId = await resolveOrProvisionHousehold(tx, customerId, session.customer_email);

            await upsertSubscription(tx, {
              householdId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              status,
              trialEndsAt: trialEnd,
            });

            // Stamp the household storage quota and tier.
            await tx
              .update(households)
              .set({ tier: "hosted_starter", storageQuotaBytes: STARTER_QUOTA_BYTES, updatedAt: new Date() })
              .where(eq(households.id, householdId));

            break;
          }

          case "customer.subscription.updated": {
            const sub = event.data.object as Stripe.Subscription;
            const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

            const existing = await tx
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

            await tx
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

            await tx
              .update(householdSubscriptions)
              .set({ status: "canceled", updatedAt: new Date() })
              .where(eq(householdSubscriptions.stripeCustomerId, customerId));

            break;
          }

          case "invoice.payment_failed": {
            const invoice = event.data.object as Stripe.Invoice;
            const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
            if (!customerId) break;

            await tx
              .update(householdSubscriptions)
              .set({ status: "past_due", updatedAt: new Date() })
              .where(eq(householdSubscriptions.stripeCustomerId, customerId));

            break;
          }

          default:
            break;
        }
      });

      await markProcessed(db, event.id, event.type);
      return c.json({ ok: true });
    } catch (err) {
      console.error("[billing] webhook handler error:", err);
      return c.json({ error: "handler_error" }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Checkout — create a Stripe Checkout Session for Starter (from the marketing pricing page)
  // ---------------------------------------------------------------------------
  app.post("/checkout", async (c) => {
    if (!isHostedDeployment(env) || !isStripeConfigured(env)) {
      return c.json({ error: "not_hosted" }, 404);
    }

    let plan = "monthly";
    try {
      const body = await c.req.parseBody();
      if (body.plan === "annual") plan = "annual";
    } catch {
      // No body / unparseable — default to monthly.
    }

    const priceId = plan === "annual" ? env.STRIPE_PRICE_STARTER_ANNUAL : env.STRIPE_PRICE_STARTER_MONTHLY;
    if (!priceId) {
      console.error(`[billing] checkout: no price configured for plan=${plan}`);
      return c.json({ error: "price_not_configured" }, 500);
    }

    const appUrl = (env.PUBLIC_APP_URL ?? "https://app.domi-ops.com").replace(/\/$/, "");
    const marketingUrl = (env.PUBLIC_MARKETING_URL ?? "https://domi-ops.com").replace(/\/$/, "");

    try {
      const stripe = makeStripe(env.STRIPE_SECRET_KEY!);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { trial_period_days: 14 },
        allow_promotion_codes: true,
        success_url: `${appUrl}/setup?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${marketingUrl}/pricing`,
      });

      if (!session.url) {
        console.error("[billing] checkout: Stripe session created with no URL");
        return c.json({ error: "session_create_failed" }, 500);
      }

      return c.redirect(session.url, 303);
    } catch (err) {
      console.error("[billing] checkout error:", err);
      return c.json({ error: "server_error" }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Hosted Setup Wizard — validate Stripe session
  // ---------------------------------------------------------------------------
  app.get("/hosted-setup/validate", async (c) => {
    if (!isHostedDeployment(env) || !isStripeConfigured(env)) {
      return c.json({ valid: false, reason: "not_hosted" });
    }

    const sessionId = c.req.query("session_id");
    if (!sessionId) return c.json({ valid: false, reason: "missing_session_id" });

    try {
      const stripe = makeStripe(env.STRIPE_SECRET_KEY!);
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        return c.json({ valid: false, reason: "not_paid" });
      }

      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (!customerId) return c.json({ valid: false, reason: "no_customer" });

      // No household_id known yet — same system_bootstrap requirement as the webhook.
      const { sub, household } = await withSystemContext(db, async (tx) => {
        const [sub] = await tx
          .select({ householdId: householdSubscriptions.householdId })
          .from(householdSubscriptions)
          .where(eq(householdSubscriptions.stripeCustomerId, customerId))
          .limit(1);

        if (!sub) return { sub: null, household: null };

        const [household] = await tx
          .select({ name: households.name })
          .from(households)
          .where(eq(households.id, sub.householdId))
          .limit(1);

        return { sub, household };
      });

      if (!sub) return c.json({ valid: false, reason: "no_household" });

      return c.json({
        valid: true,
        householdId: sub.householdId,
        email: session.customer_email,
        householdName: household?.name ?? "",
      });
    } catch (err) {
      console.error("[billing] hosted-setup/validate error:", err);
      return c.json({ valid: false, reason: "error" });
    }
  });

  // ---------------------------------------------------------------------------
  // Hosted Setup Wizard — complete account creation
  // ---------------------------------------------------------------------------
  app.post("/hosted-setup/complete", async (c) => {
    if (!isHostedDeployment(env) || !isStripeConfigured(env)) {
      return c.json({ ok: false, error: "not_hosted" }, 400);
    }

    let body: { session_id?: string; password?: string; householdName?: string; timezone?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const { session_id, password, householdName, timezone } = body;
    if (!session_id || !password || !householdName) {
      return c.json({ ok: false, error: "missing_fields" }, 400);
    }

    try {
      const stripe = makeStripe(env.STRIPE_SECRET_KEY!);
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        return c.json({ ok: false, error: "not_paid" }, 400);
      }

      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (!customerId) return c.json({ ok: false, error: "no_customer" }, 400);

      const email = (session.customer_email ?? "").trim().toLowerCase();
      if (!email) return c.json({ ok: false, error: "no_email" }, 400);

      // hashPassword is CPU-bound and doesn't touch the DB — do it outside the transaction.
      const passwordHash = await hashPassword(password);

      // No household_id known yet until the first query resolves it — same system_bootstrap
      // requirement as the webhook. users/ba_accounts aren't RLS-protected (auth tables,
      // excluded per 0038's header comment) so they're fine inside this context too.
      const result = await withSystemContext(db, async (tx) => {
        const [sub] = await tx
          .select({ householdId: householdSubscriptions.householdId })
          .from(householdSubscriptions)
          .where(eq(householdSubscriptions.stripeCustomerId, customerId))
          .limit(1);

        if (!sub) return { ok: false as const, error: "no_household" as const };

        const { householdId } = sub;

        // Idempotency: if user already exists and is a member of this household, return ok
        const [existingUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existingUser) {
          const [existingMember] = await tx
            .select({ id: householdMembers.id })
            .from(householdMembers)
            .where(eq(householdMembers.userId, existingUser.id))
            .limit(1);
          if (existingMember) return { ok: true as const };
          return { ok: false as const, error: "email_taken" as const };
        }

        const displayName = (email.split("@")[0] || "Owner").slice(0, 128);

        const [createdUser] = await tx
          .insert(users)
          .values({ email, displayName, emailVerified: true })
          .returning({ id: users.id });

        await tx.insert(baAccounts).values({
          userId: createdUser.id,
          providerId: "credential",
          accountId: email,
          password: passwordHash,
        });

        await tx.insert(householdMembers).values({
          householdId,
          userId: createdUser.id,
          role: "owner",
        });

        await tx
          .update(households)
          .set({
            name: householdName.trim().slice(0, 128),
            timezone: timezone ?? "UTC",
          })
          .where(eq(households.id, householdId));

        return { ok: true as const };
      });

      return c.json(result, result.ok ? 200 : 400);
    } catch (err) {
      console.error("[billing] hosted-setup/complete error:", err);
      return c.json({ ok: false, error: "server_error" }, 500);
    }
  });

  return app;
}
