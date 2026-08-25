import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { closeDb, createDb, households, householdSubscriptions, withSystemContext } from "./index.js";
import type { Database } from "./client.js";

/**
 * Regression coverage for the Stripe billing webhook's RLS context bug (deploy/HOSTED_BETA_SETUP.md,
 * migration 0056): apps/api/src/routes/billing.ts creates households and household_subscriptions
 * rows before any household_id is known, which household_isolation alone can never satisfy.
 * Caught during hosted beta setup by manually exercising this exact path against a real
 * domi_ops_app connection — this test keeps that from silently regressing. CI's test-hosted job
 * runs migrations + seed but never previously started the API against domi_ops_app, so this class
 * of bug wasn't covered by anything before now.
 */

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ALL_MODULES = JSON.stringify(["core", "school", "calendar_sync", "drive", "health"]);

const maybeDescribe = TEST_URL ? describe : describe.skip;

maybeDescribe("billing system_bootstrap RLS (integration)", () => {
  let db: Database;
  const createdHouseholdIds: string[] = [];
  const createdCustomerIds: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      for (const stripeCustomerId of createdCustomerIds) {
        await tx.delete(householdSubscriptions).where(eq(householdSubscriptions.stripeCustomerId, stripeCustomerId));
      }
      for (const id of createdHouseholdIds) {
        await tx.delete(households).where(eq(households.id, id));
      }
    });
    await closeDb(db);
  });

  it("blocks household creation with no RLS context (proves RLS is actually enforced)", async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);

    await expect(
      db.insert(households).values({
        name: "no-context-should-fail",
        tier: "hosted_starter",
        timezone: "UTC",
        modulesEnabled: ALL_MODULES,
        storageQuotaBytes: 26_843_545_600,
      }),
    ).rejects.toThrow();
  });

  it("allows household + household_subscriptions provisioning inside withSystemContext", async () => {
    if (!TEST_URL) return;

    const stripeCustomerId = `cus_test_${randomUUID().slice(0, 12)}`;
    const householdId = await withSystemContext(db, async (tx) => {
      const [household] = await tx
        .insert(households)
        .values({
          name: "system-bootstrap-test",
          tier: "hosted_starter",
          timezone: "UTC",
          modulesEnabled: ALL_MODULES,
          storageQuotaBytes: 26_843_545_600,
        })
        .returning({ id: households.id });

      await tx.insert(householdSubscriptions).values({
        householdId: household.id,
        modulesEntitled: ALL_MODULES,
        stripeCustomerId,
        stripeSubscriptionId: `sub_test_${randomUUID().slice(0, 12)}`,
        status: "trialing",
        trialEndsAt: null,
      });

      return household.id;
    });
    createdHouseholdIds.push(householdId);
    createdCustomerIds.push(stripeCustomerId);

    // Same shape as hosted-setup/validate: look the household up again by stripeCustomerId,
    // still with no household_id known ahead of time.
    const [readBack] = await withSystemContext(db, (tx) =>
      tx
        .select({ householdId: householdSubscriptions.householdId })
        .from(householdSubscriptions)
        .where(eq(householdSubscriptions.stripeCustomerId, stripeCustomerId)),
    );

    expect(readBack?.householdId).toBe(householdId);
  });
});
