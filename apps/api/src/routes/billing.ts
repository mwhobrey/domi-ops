import { Hono } from "hono";
import Stripe from "stripe";
import { and, eq, or } from "drizzle-orm";
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
import { createLocalAccountIssuer, hashPassword } from "@domi-ops/auth";
import type { AppVariables } from "../middleware/auth.js";

const ALL_MODULES = JSON.stringify(["core", "school", "calendar_sync", "drive", "health"]);
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

async function alreadyProcessed(db: Database, eventId: string): Promise<boolean> {
  const rows = await db.select().from(stripeEvents).where(eq(stripeEvents.id, eventId));
  return rows.length > 0;
}

async function markProcessed(db: Database, eventId: string, type: string): Promise<void> {
  await db.insert(stripeEvents).values({ id: eventId, type }).onConflictDoNothing();
}

export async function upsertSubscription(
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
      // Only take over the household's subscription row for a re-subscribe (existing row is
      // canceled) or a replay of the same subscription. If a *different* live subscription
      // already holds it — two checkout sessions the same user raced through before either
      // webhook landed (WHO-285) — keep the first; the loser is an unreferenced $0 trial that
      // expires on its own rather than a row whose customer id the lifecycle handlers would
      // then act on. Enforcing one checkout per user is the durable fix (follow-up).
      setWhere: or(
        eq(householdSubscriptions.status, "canceled"),
        eq(householdSubscriptions.stripeSubscriptionId, stripeSubscriptionId),
      ),
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
      .where(eq(householdMembers.userId, ownerUserId))
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

export function billingRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

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

            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
            const status = sub.status === "trialing" ? "trialing" : sub.status === "active" ? "active" : "trialing";

            const householdId = await resolveOrProvisionHousehold(
              tx,
              customerId,
              sessionCustomerEmail(session),
              ownerUserId,
            );

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

    if (callerUserId) {
      const [member] = await withSystemContext(db, (tx) =>
        tx
          .select({ householdId: householdMembers.householdId })
          .from(householdMembers)
          .where(eq(householdMembers.userId, callerUserId))
          .limit(1),
      );
      // Already has a household (and therefore a subscription) — a back-button or double-submit
      // here would start a second, unrelated Stripe customer + subscription that no one manages.
      // Send them to the app instead.
      if (member) return c.redirect(`${appUrl}/dashboard`, 303);
    }

    try {
      const stripe = makeStripe(env.STRIPE_SECRET_KEY!);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          trial_period_days: 14,
          ...(callerUserId ? { metadata: { whomeUserId: callerUserId } } : {}),
        },
        allow_promotion_codes: true,
        ...(callerUserId ? { client_reference_id: callerUserId } : {}),
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
      const stripe = makeStripe(env.STRIPE_SECRET_KEY!);
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
              issuer: createLocalAccountIssuer("credential"),
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
          // Better Auth's credential sign-in match requires BOTH accountId === user.id AND
          // issuer === createLocalAccountIssuer(providerId) (see node_modules/better-auth/dist/
          // api/routes/sign-in.mjs + internal-adapter.mjs) - neither was set here, meaning a
          // hosted customer who checked out with email/password could never sign back in.
          // Found via WHO-250 (same bug in the demo-seed script, root-caused there first).
          accountId: createdUser.id,
          issuer: createLocalAccountIssuer("credential"),
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
