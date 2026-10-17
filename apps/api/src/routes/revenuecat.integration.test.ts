import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, inArray, like } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { closeDb, createDb, householdMembers, households, householdSubscriptions, stripeEvents, users, withSystemContext, type Database } from "@domi-ops/db";
import { revenueCatRoutes } from "./revenuecat.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;
maybeDescribe("RevenueCat household lifecycle", () => {
  let db: Database;
  let app: Hono;
  let userId: string;
  const marker = randomUUID();
  const transactionId = `transaction-${marker}`;
  const env = { DEPLOYMENT_MODE: "shared", REVENUECAT_WEBHOOK_SECRET: "synthetic-rc-secret", REVENUECAT_ALLOWED_PRODUCT_IDS: "starter_monthly,starter_annual", REVENUECAT_ALLOWED_APP_IDS: "app_synthetic", REVENUECAT_ENTITLEMENT_ID: "starter", REVENUECAT_ENVIRONMENT: "SANDBOX" } as Env;
  let timestamp = Date.now();
  const expiry = timestamp + 86400000;
  const baseEvent = () => ({ id: `${marker}-${randomUUID()}`, app_user_id: userId, product_id: "starter_monthly", app_id: "app_synthetic", entitlement_ids: ["starter"], environment: "SANDBOX", store: "APP_STORE", original_transaction_id: transactionId, event_timestamp_ms: ++timestamp, expiration_at_ms: expiry, period_type: "NORMAL" });
  const send = (type: string, patch: Record<string, unknown> = {}) => app.request("/revenuecat/webhook", { method: "POST", headers: { authorization: "Bearer synthetic-rc-secret", "content-type": "application/json" }, body: JSON.stringify({ event: { ...baseEvent(), type, ...patch } }) });
  const row = () => withSystemContext(db, async (tx) => (await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.stripeCustomerId, `rc:${userId}`)))[0]);

  beforeAll(async () => {
    db = createDb(TEST_URL!);
    const [user] = await db.insert(users).values({ username: `rc-${marker}`, email: `rc-${marker}@example.test`, emailVerified: true }).returning();
    userId = user.id;
    app = revenueCatRoutes(db, env);
  });
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      const memberships = await tx.select().from(householdMembers).where(eq(householdMembers.userId, userId));
      if (memberships.length) await tx.delete(households).where(inArray(households.id, memberships.map((m) => m.householdId)));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(stripeEvents).where(like(stripeEvents.id, `rc:${marker}-%`));
    });
    await closeDb(db);
  });

  it("ignores mismatched product, entitlement, app and environment without creating a household", async () => {
    for (const patch of [{ product_id: "unrelated" }, { entitlement_ids: ["other"] }, { app_id: "other" }, { environment: "PRODUCTION" }]) {
      expect((await send("INITIAL_PURCHASE", patch)).status).toBe(200);
      expect(await row()).toBeUndefined();
    }
  });
  it("provisions a paid native household for a known user and detects a real trial", async () => {
    expect((await send("INITIAL_PURCHASE", { period_type: "TRIAL" })).status).toBe(200);
    const subscription = await row();
    expect(subscription.status).toBe("trialing");
    expect(subscription.trialEndsAt?.getTime()).toBe(expiry);
    expect(subscription.provider).toBe("revenuecat");
    expect(JSON.parse(subscription.modulesEntitled)).toContain("goals");
  });
  it("uses the original transaction across renewals and deduplicates retries", async () => {
    const previous = await row();
    const eventId = `${marker}-${randomUUID()}`;
    const at = ++timestamp;
    expect((await send("RENEWAL", { id: eventId, event_timestamp_ms: at })).status).toBe(200);
    expect((await row()).status).toBe("active");
    expect((await row()).stripeSubscriptionId).toBe(previous.stripeSubscriptionId);
    expect((await send("RENEWAL", { id: eventId, event_timestamp_ms: at, expiration_at_ms: expiry + 86400000 })).status).toBe(200);
    expect((await row()).currentPeriodEnd?.getTime()).toBe(expiry);
  });
  it("cancels renewal without ending paid access, then expires and rejects stale reactivation", async () => {
    expect((await send("CANCELLATION")).status).toBe(200);
    expect((await row()).status).toBe("active");
    expect((await row()).cancelAtPeriodEnd).toBe(true);
    const beforeExpiration = timestamp;
    expect((await send("EXPIRATION")).status).toBe(200);
    expect((await row()).status).toBe("canceled");
    expect((await send("RENEWAL", { event_timestamp_ms: beforeExpiration })).status).toBe(200);
    expect((await row()).status).toBe("canceled");
  });
  it("does not grant unsupported event types or another concurrent store subscription", async () => {
    expect((await send("EXPERIMENT_ENROLLMENT")).status).toBe(200);
    expect((await row()).status).toBe("canceled");
    await send("RENEWAL");
    expect((await send("INITIAL_PURCHASE", { original_transaction_id: "another-original" })).status).toBe(409);
    expect((await row()).stripeSubscriptionId).toContain(transactionId);
  });
});
