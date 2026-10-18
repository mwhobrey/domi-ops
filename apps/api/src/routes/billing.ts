import { Hono } from "hono";
import Stripe from "stripe";
import { createHmac, randomUUID } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { HOSTED_HOUSEHOLD_MODULES, isHostedDeployment, isStripeConfigured } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  baAccounts,
  billingCheckoutIntents,
  getBaseDb,
  households,
  householdMembers,
  householdSubscriptions,
  stripeEvents,
  users,
  withSystemContext,
} from "@domi-ops/db";
import { hashPassword } from "@domi-ops/auth";
import type { AppVariables } from "../middleware/auth.js";
import { stripeSubscriptionState } from "../lib/stripe-subscription.js";

const ALL_MODULES = JSON.stringify(HOSTED_HOUSEHOLD_MODULES);
const STARTER_QUOTA_BYTES = 26_843_545_600; // 25 GB

function makeStripe(secretKey: string) {
  return new Stripe(secretKey);
}

/**
 * `session.customer_email` is only populated when the email was known *before* Checkout (e.g.
 * passed in at session creation, or `customer_email` on the customer object) — for a plain
 * subscription session where the customer types their email into Checkout itself, it stays
 * `null` and the real value only shows up under `customer_details.email` once payment
 * completes. Confirmed live 2026-08-29: a real completed checkout had `customer_email: null`,
 * which meant `/hosted-setup/complete` always failed with "no_email" — this is the difference
 * between account creation actually working and every real signup dead-ending after payment.
 */
function sessionCustomerEmail(session: Stripe.Checkout.Session): string | null {
  return session.customer_details?.email ?? session.customer_email ?? null;
}

async function lockBillingIdentity(db: Database, identity: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${identity}`}, 0))`);
}

export async function upsertSubscription(
  db: Database,
  {
    householdId,
    stripeCustomerId,
    stripeSubscriptionId,
    status,
    trialEndsAt,
    currentPeriodEnd = null,
    pastDueSince = null,
    cancelAtPeriodEnd = false,
    provider = "stripe",
    sourceUpdatedAt = new Date(),
  }: {
    householdId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: "trialing" | "active" | "past_due" | "canceled";
    trialEndsAt: Date | null;
    currentPeriodEnd?: Date | null;
    pastDueSince?: Date | null;
    cancelAtPeriodEnd?: boolean;
    provider?: "stripe" | "revenuecat";
    sourceUpdatedAt?: Date;
  },
): Promise<boolean> {
  const rows = await db
    .insert(householdSubscriptions)
    .values({
      householdId,
      modulesEntitled: ALL_MODULES,
      stripeCustomerId,
      stripeSubscriptionId,
      status,
      trialEndsAt,
      currentPeriodEnd, pastDueSince, cancelAtPeriodEnd, provider, sourceUpdatedAt,
    })
    .onConflictDoUpdate({
      target: householdSubscriptions.householdId,
      set: {
        stripeCustomerId,
        stripeSubscriptionId,
        status,
        trialEndsAt,
        currentPeriodEnd, pastDueSince, cancelAtPeriodEnd, provider, sourceUpdatedAt,
        modulesEntitled: sql`case when ${householdSubscriptions.modulesEntitled}::jsonb @> '["core","school","calendar_sync","drive","health"]'::jsonb then ${ALL_MODULES} else ${householdSubscriptions.modulesEntitled} end`,
        updatedAt: new Date(),
      },
      // A different live subscription must be reconciled by the caller. A trial can
      // bill automatically; ignoring an external duplicate does not cancel it.
      setWhere: or(
        eq(householdSubscriptions.status, "canceled"),
        eq(householdSubscriptions.stripeSubscriptionId, stripeSubscriptionId),
      ),
    }).returning({ id: householdSubscriptions.id });
  return rows.length > 0;
}

/**
 * These three helpers all touch `households` / `household_subscriptions` before any
 * `householdId` is known to the caller (looked up by Stripe customer id instead) — on hosted,
 * that means RLS's normal `household_isolation` policy can never pass (there's no tenant
 * context to set yet). Callers MUST run them inside `withSystemContext` (matches the
 * `system_bootstrap` policy on all three tables — households/household_members from 0039,
 * household_subscriptions from 0056). Self-host isn't RLS-enforced so this is a no-op there.
 */

/**
 * Find or create a household for this checkout. Returns householdId.
 *
 * Reuse an existing household (WHO-285 — a repeat checkout used to spawn a fresh household every
 * time) when either:
 *   1. a subscription row is already linked to this exact Stripe customer, or
 *   2. `ownerUserId` (the signed-in user, from a validated `client_reference_id`) already belongs
 *      to a household.
 * Only match (2) on an *authenticated* identity — never on a Checkout-typed email, which the
 * payer controls and could point at another tenant's customer.
 */
export async function resolveOrProvisionHousehold(
  db: Database,
  stripeCustomerId: string,
  customerEmail: string | null,
  ownerUserId: string | null,
): Promise<string> {
  // These locks live through provisioning + subscription + owner insertion in the
  // caller's transaction. Never authorize a match using a payer-supplied email.
  if (ownerUserId) await lockBillingIdentity(db, `owner:${ownerUserId}`);
  await lockBillingIdentity(db, `customer:${stripeCustomerId}`);
  const [byCustomer] = await db
    .select({ householdId: householdSubscriptions.householdId })
    .from(householdSubscriptions)
    .where(eq(householdSubscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);
  if (byCustomer) return byCustomer.householdId;

  if (ownerUserId) {
    const [byOwner] = await db
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, ownerUserId), isNull(householdMembers.accessRevokedAt)))
      .limit(1);
    if (byOwner) return byOwner.householdId;
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

export function billingRoutes(db: Database, env: Env, stripeFactory = makeStripe) {
  const app = new Hono<{ Variables: AppVariables }>();
  // Purchase intents must commit independently of any authenticated tenant request.
  const checkoutDb = getBaseDb(db);

  // Only available on hosted deployments with Stripe configured.
  app.post("/webhook", async (c) => {
    if (!isHostedDeployment(env) || !isStripeConfigured(env)) {
      return c.json({ error: "not_found" }, 404);
    }

    const stripe = stripeFactory(env.STRIPE_SECRET_KEY!);
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

    try {
      // See the comment above resolveOrProvisionHousehold — none of these rows have a
      // household_id context yet, so every write here needs the system_bootstrap RLS policy.
      await withSystemContext(db, async (tx) => {
        // Claim and effects commit together. Concurrent deliveries block on the PK;
        // a failed handler rolls back the claim so a genuine retry can run.
        const claimed = await tx.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: stripeEvents.id });
        if (!claimed.length) return;
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            if (session.mode !== "subscription" || !session.subscription || !session.customer) break;

            const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
            const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;

            // `client_reference_id` is the signed-in user id we stamp on the session in
            // POST /checkout (WHO-285). It comes from a Stripe-signed webhook payload and was set
            // from an authenticated session — safe to attach as owner. Validate it still resolves.
            let ownerUserId: string | null = null;
            if (session.client_reference_id) {
              const [u] = await tx
                .select({ id: users.id })
                .from(users)
                .where(eq(users.id, session.client_reference_id))
                .limit(1);
              ownerUserId = u?.id ?? null;
            }

            const householdId = await resolveOrProvisionHousehold(
              tx,
              customerId,
              sessionCustomerEmail(session),
              ownerUserId,
            );
            const sub = await stripe.subscriptions.retrieve(subscriptionId);

            const accepted = await upsertSubscription(tx, {
              householdId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              ...stripeSubscriptionState(sub),
            });
            if (!accepted) {
              // Cancel the known losing subscription, including its automatic renewal.
              // Retry after an uncertain outcome retrieves current state before writing.
              if (sub.status !== "canceled") await stripe.subscriptions.cancel(subscriptionId);
              return;
            }

            // Stamp the household storage quota and tier.
            await tx
              .update(households)
              .set({ tier: "hosted_starter", storageQuotaBytes: STARTER_QUOTA_BYTES, updatedAt: new Date() })
              .where(eq(households.id, householdId));

            // Signed-in checkout: attach the user as owner now so they skip the /setup wizard
            // entirely. Idempotent — /hosted-setup/complete tolerates an already-attached member.
            if (ownerUserId) {
              const [existingMember] = await tx
                .select({ id: householdMembers.id })
                .from(householdMembers)
                .where(
                  and(
                    eq(householdMembers.householdId, householdId),
                    eq(householdMembers.userId, ownerUserId),
                  ),
                )
                .limit(1);
              if (!existingMember) {
                await tx.insert(householdMembers).values({
                  householdId,
                  userId: ownerUserId,
                  role: "owner",
                });
              }
            }

            break;
          }

          case "customer.subscription.created":
          case "customer.subscription.updated":
          case "customer.subscription.deleted":
          case "invoice.paid":
          case "invoice.payment_failed": {
            const object = event.data.object as Stripe.Subscription | Stripe.Invoice;
            const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
            if (!customerId) break;
            await lockBillingIdentity(tx, `customer:${customerId}`);
            const [existing] = await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.stripeCustomerId, customerId)).limit(1);
            if (!existing?.stripeSubscriptionId || existing.provider !== "stripe") break;
            const eventSubscription = object.object === "subscription" ? object.id
              : object.parent?.subscription_details?.subscription;
            const eventSubscriptionId = typeof eventSubscription === "string" ? eventSubscription : eventSubscription?.id;
            // Never let an unrelated invoice or losing duplicate subscription change access.
            if (eventSubscriptionId !== existing.stripeSubscriptionId) break;
            const latest = await stripe.subscriptions.retrieve(existing.stripeSubscriptionId);
            await tx.update(householdSubscriptions).set({ ...stripeSubscriptionState(latest, existing), updatedAt: new Date() }).where(eq(householdSubscriptions.id, existing.id));
            break;
          }

          default:
            break;
        }
      });

      return c.json({ ok: true });
    } catch (err) {
      console.error("[billing] webhook handler error:", err);
      return c.json({ error: "handler_error" }, 500);
    }
  });

  app.post("/portal", async (c) => {
    const auth = c.get("auth");
    if (!auth) return c.json({ error: "unauthorized" }, 401);
    if (auth.role !== "owner") return c.json({ error: "owner_required" }, 403);
    if (!isHostedDeployment(env) || !isStripeConfigured(env)) return c.json({ error: "not_hosted" }, 404);
    const ua = (c.req.header("user-agent") ?? "").toLowerCase();
    if (ua.includes("capacitor") || c.req.header("x-domi-native") === "1") return c.json({ error: "use_store_subscription_management" }, 403);
    const [subscription] = await db.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, auth.householdId)).limit(1);
    if (!subscription?.stripeCustomerId || subscription.provider !== "stripe") return c.json({ error: "use_store_subscription_management" }, 409);
    try {
      const portal = await stripeFactory(env.STRIPE_SECRET_KEY!).billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: new URL("/settings", env.PUBLIC_APP_URL).toString(),
      });
      return c.redirect(portal.url, 303);
    } catch (err) {
      console.error("[billing] portal session creation failed", err);
      return c.json({ error: "billing_portal_unavailable" }, 503);
    }
  });

  // Check current identity/provider before a native client opens a store charge.
  app.get("/purchase-access", async (c) => {
    if (!isHostedDeployment(env) || env.DEMO_MODE || !env.REVENUECAT_WEBHOOK_SECRET ||
        !env.REVENUECAT_ALLOWED_PRODUCT_IDS?.split(",").some((id) => id.trim()) ||
        !env.REVENUECAT_ALLOWED_APP_IDS?.split(",").some((id) => id.trim())) return c.json({ error: "store_not_configured" }, 404);
    const auth = c.get("auth"), userId = c.get("userId");
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    if (auth && auth.role !== "owner") return c.json({ error: "owner_required", message: "Only the household owner can manage store purchases." }, 403);
    const result = await withSystemContext(db, async (tx) => {
      const [member] = await tx.select().from(householdMembers).where(and(eq(householdMembers.userId, userId), isNull(householdMembers.accessRevokedAt))).limit(1);
      if (!member) {
        const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
        return user ? "ok" : "unauthorized";
      }
      if (member.role !== "owner") return "owner_required";
      const [sub] = await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, member.householdId)).limit(1);
      if (sub?.status !== "canceled" && sub?.provider === "stripe") return "web_subscription_active";
      if (c.req.query("action") !== "restore" && sub && sub.status !== "canceled") return "subscription_already_active";
      return "ok";
    });
    if (result !== "ok") return c.json({ error: result, message: result === "web_subscription_active" ? "Manage your existing web subscription in a browser before switching billing providers." : result === "subscription_already_active" ? "Manage the existing store subscription instead of starting another purchase." : "The household owner must sign in before purchasing." }, result === "unauthorized" ? 401 : result === "owner_required" ? 403 : 409);
    return c.json({ userId });
  });

  // ---------------------------------------------------------------------------
  // Checkout — create a Stripe Checkout Session for Starter (from the marketing pricing page)
  // ---------------------------------------------------------------------------
  app.post("/checkout", async (c) => {
    if (!isHostedDeployment(env) || !isStripeConfigured(env)) {
      return c.json({ error: "not_hosted" }, 404);
    }

    // Store builds must use RevenueCat / IAP — never Stripe Checkout inside the binary (ADR 005).
    const ua = (c.req.header("user-agent") ?? "").toLowerCase();
    if (ua.includes("capacitor") || c.req.header("x-domi-native") === "1") {
      return c.json(
        {
          error: "stripe_disabled_in_native",
          message: "Use in-app purchase on the mobile app. Stripe checkout is web-only.",
        },
        403,
      );
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

    // The pricing form POSTs cross-subdomain from the marketing site, but the Better Auth session
    // cookie (host-scoped to app.domi-ops.com, same-site under the shared domi-ops.com registrable
    // domain) still rides along. A signed-in caller here is a household-less user finishing
    // checkout — carry their id as `client_reference_id` so the webhook attaches *this* user and
    // dedupes repeat attempts (WHO-285). Anonymous checkout from the public pricing page is
    // unchanged.
    const callerUserId = c.get("userId");
    let reactivation: { householdId: string; customerId: string; subscriptionId: string } | null = null;

    if (callerUserId) {
      const [member] = await withSystemContext(db, (tx) =>
        tx
          .select({ householdId: householdMembers.householdId, role: householdMembers.role })
          .from(householdMembers)
          .where(and(eq(householdMembers.userId, callerUserId), isNull(householdMembers.accessRevokedAt)))
          .limit(1),
      );
      // Already has a household (and therefore a subscription) — a back-button or double-submit
      // here would start a second, unrelated Stripe customer + subscription that no one manages.
      // Send them to the app instead.
      if (member) {
        const [subscription] = await withSystemContext(db, (tx) => tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, member.householdId)).limit(1));
        if (member.role !== "owner" || subscription?.provider !== "stripe" || subscription.status !== "canceled" || !subscription.stripeCustomerId || !subscription.stripeSubscriptionId) return c.redirect(`${appUrl}/settings`, 303);
        reactivation = { householdId: member.householdId, customerId: subscription.stripeCustomerId, subscriptionId: subscription.stripeSubscriptionId };
      }
    }

    try {
      const stripe = stripeFactory(env.STRIPE_SECRET_KEY!);
      let browserId = getCookie(c, "domi_checkout");
      if (!browserId || !/^[0-9a-f-]{36}$/.test(browserId)) {
        browserId = randomUUID();
        setCookie(c, "domi_checkout", browserId, { httpOnly: true, secure: new URL(appUrl).protocol === "https:", sameSite: "Lax", path: "/api/billing", maxAge: 31536000 });
      }
      if (reactivation) {
        // A stale local canceled row cannot authorize a second active purchase.
        const current = await stripe.subscriptions.retrieve(reactivation.subscriptionId);
        if (current.status !== "canceled") return c.redirect(`${appUrl}/settings`, 303);
      }
      const principalKey = createHmac("sha256", env.SESSION_SECRET!).update(reactivation ? `reactivate:${reactivation.householdId}:${reactivation.subscriptionId}` : callerUserId ? `user:${callerUserId}` : `browser:${browserId}`).digest("hex");
      // Commit an intent before external calls. A crash or timeout reuses the same
      // provider idempotency key rather than replaying an uncertain purchase request.
      const intent = await withSystemContext(checkoutDb, async (tx) => {
        await lockBillingIdentity(tx, `checkout:${principalKey}`);
        const [existing] = await tx.select().from(billingCheckoutIntents).where(eq(billingCheckoutIntents.principalKey, principalKey));
        if (existing) return existing;
        const [created] = await tx.insert(billingCheckoutIntents).values({ principalKey, plan, expiresAt: new Date(Date.now() + 86400000) }).returning();
        return created;
      });
      let priorSession: Stripe.Checkout.Session | null = null;
      if (intent.stripeSessionId) {
        priorSession = await stripe.checkout.sessions.retrieve(intent.stripeSessionId);
        if (priorSession.status === "complete") return c.redirect(`${appUrl}/setup?session_id=${encodeURIComponent(priorSession.id)}`, 303);
        if (priorSession.status === "open" && priorSession.url) return c.redirect(priorSession.url, 303);
        if (priorSession.status === "expired") {
          // The provider confirmed this specific attempt cannot complete. Clear it
          // explicitly; never mint a fresh request merely because a local timer passed.
          await withSystemContext(checkoutDb, (tx) => tx.delete(billingCheckoutIntents).where(and(eq(billingCheckoutIntents.principalKey, principalKey), eq(billingCheckoutIntents.id, intent.id))));
          return c.redirect(`${marketingUrl}/pricing?checkout=expired`, 303);
        }
      }
      if (!intent.stripeSessionId && intent.expiresAt.getTime() <= Date.now()) {
        // Stripe may have accepted an earlier request even if its response was lost.
        // Do not replay beyond its idempotency retention window; operator reconciliation.
        return c.json({ error: "checkout_reconciliation_required", message: "Contact support to safely resume this checkout." }, 409);
      }
      const customer = reactivation ? { id: reactivation.customerId } : intent.stripeCustomerId ? { id: intent.stripeCustomerId }
        : await stripe.customers.create({}, { idempotencyKey: `domi-customer:${intent.id}` });
      await withSystemContext(checkoutDb, (tx) => tx.update(billingCheckoutIntents).set({ stripeCustomerId: customer.id }).where(eq(billingCheckoutIntents.id, intent.id)));
      const lockedPrice = intent.plan === "annual" ? env.STRIPE_PRICE_STARTER_ANNUAL : env.STRIPE_PRICE_STARTER_MONTHLY;
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.id,
        line_items: [{ price: lockedPrice, quantity: 1 }],
        subscription_data: {
          ...(!reactivation ? { trial_period_days: 14 } : {}),
          ...(callerUserId ? { metadata: { whomeUserId: callerUserId } } : {}),
        },
        allow_promotion_codes: true,
        ...(callerUserId ? { client_reference_id: callerUserId } : {}),
        success_url: `${appUrl}/setup?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${marketingUrl}/pricing`,
      }, { idempotencyKey: `domi-checkout:${intent.id}` });
      await withSystemContext(checkoutDb, (tx) => tx.update(billingCheckoutIntents).set({ stripeSessionId: session.id }).where(eq(billingCheckoutIntents.id, intent.id)));

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
      const stripe = stripeFactory(env.STRIPE_SECRET_KEY!);
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        return c.json({ valid: false, reason: "not_paid" });
      }

      // A signed-in checkout (`client_reference_id` set) exposes its household name + email only
      // to the user who started it — `session_id` sits in the /setup URL and leaks (WHO-285).
      // Anonymous checkouts have no owner to check against.
      if (session.client_reference_id && session.client_reference_id !== c.get("userId")) {
        return c.json({ valid: false, reason: "signin_required" });
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
        email: sessionCustomerEmail(session),
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

    // Identity resolution here has two paths (WHO-285):
    //   - the session was started by a signed-in user (`client_reference_id` is set, from
    //     POST /checkout) — attach *that* user, whatever email they typed into Stripe Checkout.
    //     A session started by user A can only be completed by A: `session_id` values leak
    //     (they sit in the /setup URL), so a bare "signed in + knows the id" is not enough.
    //   - anonymous checkout (`client_reference_id` absent): fall back to the checkout email —
    //     attach a pre-existing memberless user only if the caller is signed in AS that user, or
    //     create a fresh one. Never attach a pre-existing user with a credential/membership on a
    //     typed email alone (that would let a payer hijack a victim's orphaned account).
    const callerUserId = c.get("userId");

    try {
      const stripe = stripeFactory(env.STRIPE_SECRET_KEY!);
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        return c.json({ ok: false, error: "not_paid" }, 400);
      }

      const sessionOwnerId = session.client_reference_id;
      // A signed-in checkout belongs to exactly one user — reject anyone else's session.
      if (sessionOwnerId && sessionOwnerId !== callerUserId) {
        return c.json({ ok: false, error: "signin_required" }, 400);
      }

      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (!customerId) return c.json({ ok: false, error: "no_customer" }, 400);

      const email = (sessionCustomerEmail(session) ?? "").trim().toLowerCase();
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

        const applyHouseholdSettings = () =>
          tx
            .update(households)
            .set({
              name: householdName.trim().slice(0, 128),
              timezone: timezone ?? "UTC",
            })
            .where(eq(households.id, householdId));

        const ensureCredentialFallback = async (userId: string) => {
          const [cred] = await tx
            .select({ id: baAccounts.id })
            .from(baAccounts)
            .where(and(eq(baAccounts.userId, userId), eq(baAccounts.providerId, "credential")))
            .limit(1);
          // Give them an email/password fallback login too (their Google account keeps working
          // via Better Auth's default implicit linking). Never overwrite an existing credential —
          // the password field is set-once at setup.
          if (!cred && passwordHash) {
            await tx.insert(baAccounts).values({
              userId,
              providerId: "credential",
              accountId: userId,
              password: passwordHash,
            });
          }
        };

        // Signed-in caller wins over the checkout email — but only for a session we can
        // positively tie to them (`client_reference_id`, set in POST /checkout). An anonymous
        // session (no `client_reference_id`) can't be claimed this way; it drops to the
        // email-based path below. (WHO-285)
        if (callerUserId && sessionOwnerId === callerUserId) {
          const [caller] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, callerUserId))
            .limit(1);

          if (caller) {
            const [callerMember] = await tx
              .select({ id: householdMembers.id, householdId: householdMembers.householdId })
              .from(householdMembers)
              .where(eq(householdMembers.userId, caller.id))
              .limit(1);

            if (callerMember) {
              // Already attached — e.g. the webhook's signed-in-checkout path beat us here.
              if (callerMember.householdId === householdId) {
                await applyHouseholdSettings();
                return { ok: true as const };
              }
              return { ok: false as const, error: "email_taken" as const };
            }

            await ensureCredentialFallback(caller.id);
            await tx.insert(householdMembers).values({
              householdId,
              userId: caller.id,
              role: "owner",
            });
            await applyHouseholdSettings();
            return { ok: true as const };
          }
          // callerUserId set but the row is gone (deleted mid-flow) — fall through to email.
        }

        const [existingUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existingUser) {
          const [existingMember] = await tx
            .select({
              id: householdMembers.id,
              householdId: householdMembers.householdId,
            })
            .from(householdMembers)
            .where(eq(householdMembers.userId, existingUser.id))
            .limit(1);

          // Already attached. Idempotent replay if it's this household; a real conflict if
          // they somehow belong to a different one (shouldn't happen on hosted).
          if (existingMember) {
            return existingMember.householdId === householdId
              ? { ok: true as const }
              : { ok: false as const, error: "email_taken" as const };
          }

          // User row exists but no household, and no signed-in caller matched above — an
          // anonymous completion can't prove it owns this address, so it can't claim the
          // account. (The signed-in case is handled by the caller-wins branch earlier.)
          if (!callerUserId || callerUserId !== existingUser.id) {
            return { ok: false as const, error: "signin_required" as const };
          }

          await ensureCredentialFallback(existingUser.id);

          await tx.insert(householdMembers).values({
            householdId,
            userId: existingUser.id,
            role: "owner",
          });
          await applyHouseholdSettings();
          return { ok: true as const };
        }

        const displayName = (email.split("@")[0] || "Owner").slice(0, 128);

        const [createdUser] = await tx
          .insert(users)
          .values({ email, displayName, emailVerified: true })
          .returning({ id: users.id });

        await tx.insert(baAccounts).values({
          userId: createdUser.id,
          providerId: "credential",
          // Better Auth matches the credential account on (providerId, accountId) with accountId === user.id.
          accountId: createdUser.id,
          password: passwordHash,
        });

        await tx.insert(householdMembers).values({
          householdId,
          userId: createdUser.id,
          role: "owner",
        });

        await applyHouseholdSettings();
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
