import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  closeDb,
  createDb,
  households,
  householdMembers,
  householdSubscriptions,
  users,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import { resolveOrProvisionHousehold, upsertSubscription } from "./billing.js";

/**
 * WHO-285 — a repeat hosted checkout used to provision a fresh household every time, and the
 * dedup must never reach across tenants via a payer-typed email. Needs a live Postgres
 * (`DATABASE_URL` / `HOSTED_TEST_DATABASE_URL`); part of `npm run test:hosted`.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ALL_MODULES = JSON.stringify(["core", "school", "calendar_sync", "drive", "health"]);
const maybeDescribe = TEST_URL ? describe : describe.skip;

maybeDescribe("resolveOrProvisionHousehold (integration)", () => {
  let db: Database;
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const customerIds: string[] = [];

  const seedHousehold = (name: string) =>
    withSystemContext(db, async (tx) => {
      const [h] = await tx
        .insert(households)
        .values({
          name,
          tier: "hosted_starter",
          timezone: "UTC",
          modulesEnabled: ALL_MODULES,
          storageQuotaBytes: 26_843_545_600,
        })
        .returning({ id: households.id });
      householdIds.push(h.id);
      return h.id;
    });

  const seedSubscription = (householdId: string, stripeCustomerId: string) =>
    withSystemContext(db, (tx) => {
      customerIds.push(stripeCustomerId);
      return tx.insert(householdSubscriptions).values({
        householdId,
        modulesEntitled: ALL_MODULES,
        stripeCustomerId,
        stripeSubscriptionId: `sub_${randomUUID().slice(0, 12)}`,
        status: "trialing",
        trialEndsAt: null,
      });
    });

  const seedUser = (email = `who285-${randomUUID().slice(0, 8)}@example.test`) =>
    withSystemContext(db, async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ email, emailVerified: true })
        .returning({ id: users.id });
      userIds.push(u.id);
      return u.id;
    });

  const seedMember = (householdId: string, userId: string) =>
    withSystemContext(db, (tx) =>
      tx.insert(householdMembers).values({ householdId, userId, role: "owner" }),
    );

  beforeAll(() => {
    if (TEST_URL) db = createDb(TEST_URL);
  });

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (customerIds.length)
        await tx
          .delete(householdSubscriptions)
          .where(inArray(householdSubscriptions.stripeCustomerId, customerIds));
      if (householdIds.length)
        await tx.delete(households).where(inArray(households.id, householdIds));
      if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
    });
    await closeDb(db);
  });

  it("provisions a new household when nothing matches", async () => {
    const customerId = `cus_${randomUUID().slice(0, 14)}`;
    customerIds.push(customerId);
    const householdId = await withSystemContext(db, (tx) =>
      resolveOrProvisionHousehold(tx, customerId, "new@example.test", null),
    );
    householdIds.push(householdId);

    const [row] = await withSystemContext(db, (tx) =>
      tx.select({ name: households.name }).from(households).where(eq(households.id, householdId)),
    );
    expect(row?.name).toBe("new");
  });

  it("reuses the household already linked to this exact Stripe customer", async () => {
    const hh = await seedHousehold("who285-exact");
    const customerId = `cus_${randomUUID().slice(0, 14)}`;
    await seedSubscription(hh, customerId);

    const resolved = await withSystemContext(db, (tx) =>
      resolveOrProvisionHousehold(tx, customerId, "exact@example.test", null),
    );
    expect(resolved).toBe(hh);
  });

  it("reuses the signed-in user's household on a repeat checkout (new Stripe customer)", async () => {
    const hh = await seedHousehold("who285-repeat");
    const userId = await seedUser();
    await seedMember(hh, userId);

    // Second checkout — brand-new customer id, but same owner via client_reference_id.
    const resolved = await withSystemContext(db, (tx) =>
      resolveOrProvisionHousehold(tx, `cus_${randomUUID().slice(0, 14)}`, "repeat@example.test", userId),
    );
    expect(resolved).toBe(hh);
  });

  it("never reaches another tenant's household via the checkout email", async () => {
    const victimEmail = `who285-victim-${randomUUID().slice(0, 8)}@example.test`;
    const victimHh = await seedHousehold("who285-victim");
    await seedMember(victimHh, await seedUser(victimEmail));
    await seedSubscription(victimHh, `cus_${randomUUID().slice(0, 14)}`);

    const attacker = await seedUser();
    // Attacker's checkout: fresh customer, attacker's own id, but the victim's real email typed
    // into Stripe Checkout — must NOT resolve to the victim household (no email-based dedup).
    const resolved = await withSystemContext(db, (tx) =>
      resolveOrProvisionHousehold(tx, `cus_${randomUUID().slice(0, 14)}`, victimEmail, attacker),
    );
    householdIds.push(resolved);
    expect(resolved).not.toBe(victimHh);
  });

  it("upsertSubscription keeps the first live subscription when a raced second one lands", async () => {
    const hh = await seedHousehold("who285-race");
    const customerA = `cus_${randomUUID().slice(0, 14)}`;
    const subA = `sub_${randomUUID().slice(0, 14)}`;
    const customerB = `cus_${randomUUID().slice(0, 14)}`;
    customerIds.push(customerA, customerB);

    const read = () =>
      withSystemContext(db, (tx) =>
        tx
          .select({
            customer: householdSubscriptions.stripeCustomerId,
            sub: householdSubscriptions.stripeSubscriptionId,
            status: householdSubscriptions.status,
          })
          .from(householdSubscriptions)
          .where(eq(householdSubscriptions.householdId, hh))
          .limit(1),
      );

    await withSystemContext(db, (tx) =>
      upsertSubscription(tx, {
        householdId: hh,
        stripeCustomerId: customerA,
        stripeSubscriptionId: subA,
        status: "trialing",
        trialEndsAt: null,
      }),
    );

    // Raced second webhook — different live subscription for the same household.
    await withSystemContext(db, (tx) =>
      upsertSubscription(tx, {
        householdId: hh,
        stripeCustomerId: customerB,
        stripeSubscriptionId: `sub_${randomUUID().slice(0, 14)}`,
        status: "trialing",
        trialEndsAt: null,
      }),
    );
    expect((await read())[0]).toMatchObject({ customer: customerA, sub: subA });

    // Same subscription replays with a status change — that still applies.
    await withSystemContext(db, (tx) =>
      upsertSubscription(tx, {
        householdId: hh,
        stripeCustomerId: customerA,
        stripeSubscriptionId: subA,
        status: "active",
        trialEndsAt: null,
      }),
    );
    expect((await read())[0]).toMatchObject({ sub: subA, status: "active" });

    // After cancellation a genuine re-subscribe takes the row over.
    await withSystemContext(db, (tx) =>
      tx
        .update(householdSubscriptions)
        .set({ status: "canceled" })
        .where(eq(householdSubscriptions.householdId, hh)),
    );
    const customerC = `cus_${randomUUID().slice(0, 14)}`;
    customerIds.push(customerC);
    await withSystemContext(db, (tx) =>
      upsertSubscription(tx, {
        householdId: hh,
        stripeCustomerId: customerC,
        stripeSubscriptionId: `sub_${randomUUID().slice(0, 14)}`,
        status: "trialing",
        trialEndsAt: null,
      }),
    );
    expect((await read())[0]).toMatchObject({ customer: customerC, status: "trialing" });
  });
});
