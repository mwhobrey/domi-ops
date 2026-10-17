import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { billingCheckoutIntents, closeDb, createDb, createScopedDb, householdMembers, households, householdSubscriptions, stripeEvents, users, withSystemContext, withHouseholdContext, type Database } from "@domi-ops/db";
import { billingRoutes } from "./billing.js";
import { createTenantMiddleware } from "../middleware/tenant.js";
import { createSubscriptionMiddleware } from "../middleware/subscription.js";
import { householdSubscriptionAllowsWork } from "@domi-ops/calendar-sync";
import { profileRoutes } from "./profile.js";
import { choresRoutes } from "./chores.js";
import { expensesRoutes } from "./expenses.js";
import { shoppingRoutes } from "./shopping.js";
import { chores, choresRecurring, expenseRecurring, expenses, shoppingItems, shoppingRecurring } from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import type { AuthContext } from "@domi-ops/auth";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;
const secret = "whsec_synthetic_test_secret";

maybeDescribe("hosted billing integrity", () => {
  let db: Database;
  let app: Hono<{ Variables: AppVariables }>;
  const marker = randomUUID();
  const customerIds: string[] = [];
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const eventIds: string[] = [];
  const state = new Map<string, Stripe.Subscription>();
  const canceled: string[] = [];
  const calls: { retrieve: number; portal: string[]; checkoutKeys: string[]; checkoutCreates: number } = { retrieve: 0, portal: [], checkoutKeys: [], checkoutCreates: 0 };
  let failRetrieve = false;
  let owner: AuthContext;
  let pendingUserId: string;
  const sessions = new Map<string, Stripe.Checkout.Session>();
  const customers = new Map<string, { id: string }>();
  const checkoutParameters: Stripe.Checkout.SessionCreateParams[] = [];
  const provider = new Stripe("sk_test_synthetic");
  const env = {
    DEPLOYMENT_MODE: "shared", NODE_ENV: "test", AUTH_REQUIRED: true,
    STRIPE_SECRET_KEY: "sk_test_synthetic", STRIPE_WEBHOOK_SECRET: secret,
    STRIPE_PRICE_STARTER_MONTHLY: "price_monthly", STRIPE_PRICE_STARTER_ANNUAL: "price_annual",
    REVENUECAT_WEBHOOK_SECRET: "synthetic-store-secret",
    PUBLIC_APP_URL: "https://app.test", PUBLIC_MARKETING_URL: "https://www.test", SESSION_SECRET: "synthetic-session-secret-32-characters",
    MODULES_ENABLED: ["core", "school", "health", "drive", "calendar_sync", "goals"],
  } as Env;
  const fake = {
    webhooks: provider.webhooks,
    subscriptions: {
      retrieve: async (id: string) => { calls.retrieve++; if (failRetrieve) { failRetrieve = false; throw new Error("synthetic transient provider failure"); } return state.get(id)!; },
      cancel: async (id: string) => { canceled.push(id); const s = state.get(id)!; s.status = "canceled"; return s; },
    },
    customers: { create: async (_params: unknown, options: { idempotencyKey: string }) => {
      if (!customers.has(options.idempotencyKey)) customers.set(options.idempotencyKey, { id: `cus_${randomUUID()}` });
      return customers.get(options.idempotencyKey)!;
    } },
    checkout: { sessions: {
      retrieve: async (id: string) => [...sessions.values()].find((s) => s.id === id)!,
      create: async (params: Stripe.Checkout.SessionCreateParams, options: { idempotencyKey: string }) => {
        const intentId = options.idempotencyKey.slice("domi-checkout:".length);
        // A separate connection must already see the committed intent before provider I/O.
        expect(await withSystemContext(db, (tx) => tx.select().from(billingCheckoutIntents).where(eq(billingCheckoutIntents.id, intentId)))).toHaveLength(1);
        checkoutParameters.push(params);
        calls.checkoutKeys.push(options.idempotencyKey);
        if (!sessions.has(options.idempotencyKey)) { calls.checkoutCreates++; sessions.set(options.idempotencyKey, { id: `cs_${randomUUID()}`, url: "https://checkout.stripe.test/synthetic", status: "open", customer: params.customer } as Stripe.Checkout.Session); }
        return sessions.get(options.idempotencyKey)!;
      },
    } },
    billingPortal: { sessions: { create: async (params: { customer: string; return_url: string }) => { calls.portal.push(params.customer); expect(params.return_url).toBe("https://app.test/settings"); return { url: "https://billing.stripe.test/session" }; } } },
  } as unknown as Stripe;

  function subscription(customerId: string, id = `sub_${randomUUID()}`) {
    const sub = { object: "subscription", id, customer: customerId, status: "active", trial_end: null, cancel_at_period_end: false, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 864000, price: { id: "price_monthly" } }] } } as Stripe.Subscription;
    state.set(id, sub); return sub;
  }
  async function webhook(type: string, object: unknown, id = `evt_${randomUUID()}`) {
    eventIds.push(id);
    const payload = JSON.stringify({ id, type, data: { object }, created: Math.floor(Date.now() / 1000) });
    return app.request("/api/billing/webhook", { method: "POST", body: payload, headers: { "stripe-signature": provider.webhooks.generateTestHeaderString({ payload, secret }) } });
  }
  const checkoutEvent = (sub: Stripe.Subscription, userId?: string) => ({ object: "checkout.session", mode: "subscription", customer: sub.customer, subscription: sub.id, customer_details: { email: "synthetic@example.test" }, client_reference_id: userId });
  const rowsFor = (id: string) => withSystemContext(db, (tx) => tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.stripeCustomerId, id)));

  beforeAll(async () => {
    db = createDb(TEST_URL!);
    pendingUserId = await withSystemContext(db, async (tx) => {
      const [u] = await tx.insert(users).values({ username: `billing-${marker}`, email: `billing-${marker}@example.test` }).returning();
      userIds.push(u.id); return u.id;
    });
    const scoped = createScopedDb(db);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      const as = c.req.header("x-as");
      c.set("auth", as === "owner" ? owner : as === "admin" ? { ...owner, role: "admin" } : null);
      c.set("userId", as === "pending" ? pendingUserId : as === "owner" || as === "admin" ? owner.userId : null);
      await next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.use("/api/*", createSubscriptionMiddleware(scoped, env));
    app.route("/api/billing", billingRoutes(scoped, env, () => fake));
    app.route("/api/core", profileRoutes(scoped, env));
    app.route("/api/core", choresRoutes(scoped, env));
    app.route("/api/core", expensesRoutes(scoped, env));
    app.route("/api/core", shoppingRoutes(scoped, env));
    app.get("/api/test/read", (c) => c.json({ ok: true }));
    app.post("/api/test/write", (c) => c.json({ ok: true }));
  });
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (customerIds.length) for (const row of await tx.select().from(householdSubscriptions).where(inArray(householdSubscriptions.stripeCustomerId, customerIds))) householdIds.push(row.householdId);
      if (householdIds.length) await tx.delete(households).where(inArray(households.id, householdIds));
      if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
      if (eventIds.length) await tx.delete(stripeEvents).where(inArray(stripeEvents.id, eventIds));
      const intents = await tx.select().from(billingCheckoutIntents);
      const ourCustomers = new Set([...customers.values()].map((c) => c.id));
      for (const intent of intents) if (intent.stripeCustomerId && ourCustomers.has(intent.stripeCustomerId)) await tx.delete(billingCheckoutIntents).where(eq(billingCheckoutIntents.id, intent.id));
    });
    await closeDb(db);
  });

  it("claims webhook deliveries atomically and provisions one household for concurrent events", async () => {
    const customer = `cus_${randomUUID()}`; customerIds.push(customer);
    const sub = subscription(customer);
    const event = `evt_${randomUUID()}`;
    const before = calls.retrieve;
    const results = await Promise.all([webhook("checkout.session.completed", checkoutEvent(sub), event), webhook("checkout.session.completed", checkoutEvent(sub), event)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(calls.retrieve - before).toBe(1);
    const distinct = await Promise.all([webhook("checkout.session.completed", checkoutEvent(sub)), webhook("checkout.session.completed", checkoutEvent(sub))]);
    expect(distinct.map((r) => r.status)).toEqual([200, 200]);
    expect(await rowsFor(customer)).toHaveLength(1);
    expect(JSON.parse((await rowsFor(customer))[0].modulesEntitled)).toContain("goals");
  });

  it("rolls back receipt and provisioning after a provider failure and accepts a real retry", async () => {
    const customer = `cus_${randomUUID()}`; customerIds.push(customer);
    const sub = subscription(customer); const event = `evt_${randomUUID()}`;
    failRetrieve = true;
    expect((await webhook("checkout.session.completed", checkoutEvent(sub), event)).status).toBe(500);
    expect(await rowsFor(customer)).toHaveLength(0);
    expect((await webhook("checkout.session.completed", checkoutEvent(sub), event)).status).toBe(200);
    expect(await rowsFor(customer)).toHaveLength(1);
  });

  it("cancels a losing duplicate instead of allowing its trial to bill", async () => {
    const customer = `cus_${randomUUID()}`; customerIds.push(customer);
    const first = subscription(customer);
    expect((await webhook("checkout.session.completed", checkoutEvent(first, pendingUserId))).status).toBe(200);
    const [row] = await rowsFor(customer);
    owner = await withSystemContext(db, async (tx) => {
      const [member] = await tx.select().from(householdMembers).where(eq(householdMembers.userId, pendingUserId));
      return { householdId: row.householdId, userId: pendingUserId, memberId: member.id, role: "owner" } as AuthContext;
    });
    const otherCustomer = `cus_${randomUUID()}`; customerIds.push(otherCustomer);
    const duplicate = subscription(otherCustomer);
    expect((await webhook("checkout.session.completed", checkoutEvent(duplicate, pendingUserId))).status).toBe(200);
    expect(canceled).toContain(duplicate.id);
    expect((await rowsFor(customer))[0].stripeSubscriptionId).toBe(first.id);
    expect(await rowsFor(otherCustomer)).toHaveLength(0);
  });

  it("refreshes current provider state and ignores unrelated subscription events", async () => {
    const [row] = await withSystemContext(db, (tx) => tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, owner.householdId)));
    const live = state.get(row.stripeSubscriptionId!)!;
    expect((await webhook("customer.subscription.updated", { ...live, status: "past_due" })).status).toBe(200);
    expect((await rowsFor(row.stripeCustomerId!))[0].status).toBe("active");
    const unrelated = subscription(row.stripeCustomerId!);
    unrelated.status = "canceled";
    expect((await webhook("customer.subscription.deleted", unrelated)).status).toBe(200);
    expect((await rowsFor(row.stripeCustomerId!))[0].stripeSubscriptionId).toBe(live.id);
  });

  it("restricts billing portal to the owner and the recorded household customer", async () => {
    expect((await app.request("/api/billing/portal", { method: "POST", headers: { "x-as": "admin" } })).status).toBe(403);
    const result = await app.request("/api/billing/portal", { method: "POST", headers: { "x-as": "owner" }, body: "customer=forged" });
    expect(result.status).toBe(303);
    expect(calls.portal.at(-1)).toBe((await withSystemContext(db, (tx) => tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, owner.householdId))))[0].stripeCustomerId);
  });
  it("rejects native purchase preflight before a non-owner or active web customer can open a store charge", async () => {
    expect((await app.request("/api/billing/purchase-access")).status).toBe(401);
    expect((await app.request("/api/billing/purchase-access", { headers: { "x-as": "admin" } })).status).toBe(403);
    expect((await app.request("/api/billing/purchase-access", { headers: { "x-as": "owner" } })).status).toBe(409);
    expect((await app.request("/api/billing/purchase-access?action=restore", { headers: { "x-as": "owner" } })).status).toBe(409);
  });

  it("keeps data readable, stops writes and jobs after cancellation, and blocks abandoned billing on deletion", async () => {
    expect((await app.request("/api/core/profile/account", { method: "DELETE", headers: { "x-as": "owner", "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) })).status).toBe(409);
    await withHouseholdContext(db, owner.householdId, (tx) => tx.update(householdSubscriptions).set({ status: "canceled" }).where(eq(householdSubscriptions.householdId, owner.householdId)));
    expect((await app.request("/api/test/read", { headers: { "x-as": "owner" } })).status).toBe(200);
    expect((await app.request("/api/test/write", { method: "POST", headers: { "x-as": "owner" } })).status).toBe(402);
    expect(await householdSubscriptionAllowsWork(db, env, owner.householdId)).toBe(false);
    const native = await app.request("/api/billing/purchase-access", { headers: { "x-as": "owner" } });
    expect(native.status).toBe(200); expect(await native.json()).toEqual({ userId: owner.userId });
    expect((await app.request("/api/billing/portal", { method: "POST", headers: { "x-as": "owner" } })).status).toBe(303);
  });

  it("reuses provider request IDs for concurrent checkouts from the same browser", async () => {
    const cookie = `domi_checkout=${randomUUID()}`;
    const results = await Promise.all([1, 2].map(() => app.request("/api/billing/checkout", { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: "plan=monthly" })));
    expect(results.map((r) => r.status)).toEqual([303, 303]);
    expect(new Set(calls.checkoutKeys).size).toBe(1);
    expect(calls.checkoutCreates).toBe(1);
    const again = await app.request("/api/billing/checkout", { method: "POST", headers: { cookie }, body: "plan=annual" });
    expect(again.status).toBe(303);
    expect(calls.checkoutCreates).toBe(1);
  });
  it("restarts a canceled owner's existing household without repeating a trial or trusting stale state", async () => {
    const [row] = await withSystemContext(db, (tx) => tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, owner.householdId)));
    const live = state.get(row.stripeSubscriptionId!)!;
    expect(live.status).toBe("active");
    const before = calls.checkoutCreates;
    expect((await app.request("/api/billing/checkout", { method: "POST", headers: { "x-as": "owner" }, body: "plan=monthly" })).headers.get("location")).toBe("https://app.test/settings");
    expect(calls.checkoutCreates).toBe(before);
    live.status = "canceled";
    const results = await Promise.all([1, 2].map(() => app.request("/api/billing/checkout", { method: "POST", headers: { "x-as": "owner" }, body: "plan=annual" })));
    expect(results.map((r) => r.status)).toEqual([303, 303]);
    expect(calls.checkoutCreates - before).toBe(1);
    expect(checkoutParameters.at(-1)).toMatchObject({ customer: row.stripeCustomerId, client_reference_id: owner.userId });
    expect(checkoutParameters.at(-1)?.subscription_data?.trial_period_days).toBeUndefined();
  });
  it("keeps recurring GET requests read-only after expiry but materializes for active subscriptions", async () => {
    await withHouseholdContext(db, owner.householdId, async (tx) => {
      await tx.insert(choresRecurring).values({ householdId: owner.householdId, description: "Synthetic chore", nextAt: "2026-10-01" });
      await tx.insert(shoppingRecurring).values({ householdId: owner.householdId, item: "Synthetic item", nextAt: "2026-10-01" });
      await tx.insert(expenseRecurring).values({ householdId: owner.householdId, title: "Synthetic bill", amount: 1, anchorDate: "2026-10-01", nextAt: "2026-10-01" });
    });
    const read = async () => { for (const path of ["chores", "shopping", "expenses"]) expect((await app.request(`/api/core/${path}`, { headers: { "x-as": "owner" } })).status).toBe(200); };
    const counts = () => withHouseholdContext(db, owner.householdId, async (tx) => [
      (await tx.select().from(chores).where(eq(chores.householdId, owner.householdId))).length,
      (await tx.select().from(shoppingItems).where(eq(shoppingItems.householdId, owner.householdId))).length,
      (await tx.select().from(expenses).where(eq(expenses.householdId, owner.householdId))).length,
    ]);
    await read(); expect(await counts()).toEqual([0, 0, 0]);
    await withHouseholdContext(db, owner.householdId, (tx) => tx.update(householdSubscriptions).set({ status: "active", currentPeriodEnd: new Date(Date.now() + 86400000) }).where(eq(householdSubscriptions.householdId, owner.householdId)));
    await read(); expect((await counts()).every((n) => n > 0)).toBe(true);
  });
});
