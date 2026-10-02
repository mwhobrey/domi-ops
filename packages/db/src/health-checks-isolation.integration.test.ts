import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb, withHouseholdContext, withWorkerScanContext } from "./index.js";
import {
  healthCheckGroupMembers,
  healthCheckGroups,
  healthCheckLogs,
  healthCheckPauses,
  healthCheckReminderSent,
  healthCheckShares,
  healthChecks,
  householdMembers,
  households,
} from "./schema/index.js";
import type { Database } from "./client.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const maybeDescribe = TEST_URL ? describe : describe.skip;

/** Scheduled health checks (WHO-379/380, migration 0085): RLS isolation + DB constraints. */
maybeDescribe("health checks tenant isolation (integration)", () => {
  const marker = `hc-iso-${Date.now()}`;
  let db: Database;

  type Tenant = {
    householdId: string;
    memberId: string;
    checkId: string;
    groupId: string;
  };
  let alpha: Tenant;
  let beta: Tenant;

  async function seedTenant(slug: string, label: string): Promise<Tenant> {
    const [household] = await withWorkerScanContext(db, (tx) =>
      tx.select({ id: households.id }).from(households).where(eq(households.slug, slug)).limit(1),
    );
    if (!household) throw new Error("Run npm run db:seed-hosted-qa before tenant isolation tests");

    return withHouseholdContext(db, household.id, async (tx) => {
      const [member] = await tx
        .select({ id: householdMembers.id })
        .from(householdMembers)
        .where(eq(householdMembers.householdId, household.id))
        .limit(1);
      if (!member) throw new Error(`No member in ${slug}`);

      const [check] = await tx
        .insert(healthChecks)
        .values({
          householdId: household.id,
          memberId: member.id,
          name: `${marker}-${label}-bp`,
          eventType: "vitals",
          scheduleJson: JSON.stringify({ times: ["08:00", "12:00", "16:00", "20:00"] }),
        })
        .returning({ id: healthChecks.id });
      const [group] = await tx
        .insert(healthCheckGroups)
        .values({ householdId: household.id, memberId: member.id, name: `${marker}-${label}-group` })
        .returning({ id: healthCheckGroups.id });

      await tx.insert(healthCheckGroupMembers).values({ groupId: group!.id, checkId: check!.id });
      await tx.insert(healthCheckShares).values({ checkId: check!.id, memberId: member.id });
      await tx.insert(healthCheckPauses).values({ checkId: check!.id });
      await tx.insert(healthCheckLogs).values({
        checkId: check!.id,
        scheduledAt: new Date("2026-10-02T13:00:00.000Z"),
        status: "done",
      });

      return { householdId: household.id, memberId: member.id, checkId: check!.id, groupId: group!.id };
    });
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    alpha = await seedTenant("alpha-hosted", "alpha");
    beta = await seedTenant("beta-hosted", "beta");
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    // Children cascade from the check / group rows.
    await withWorkerScanContext(db, async (tx) => {
      await tx.delete(healthChecks).where(like(healthChecks.name, `${marker}%`));
      await tx.delete(healthCheckGroups).where(like(healthCheckGroups.name, `${marker}%`));
    });
    await closeDb(db);
  });

  it("scopes checks and groups to the active household", async () => {
    const alphaChecks = await withHouseholdContext(db, alpha.householdId, (tx) =>
      tx.select({ name: healthChecks.name }).from(healthChecks).where(like(healthChecks.name, `${marker}%`)),
    );
    const betaChecks = await withHouseholdContext(db, beta.householdId, (tx) =>
      tx.select({ name: healthChecks.name }).from(healthChecks).where(like(healthChecks.name, `${marker}%`)),
    );
    expect(alphaChecks.map((c) => c.name)).toEqual([`${marker}-alpha-bp`]);
    expect(betaChecks.map((c) => c.name)).toEqual([`${marker}-beta-bp`]);

    const alphaGroups = await withHouseholdContext(db, alpha.householdId, (tx) =>
      tx.select({ name: healthCheckGroups.name }).from(healthCheckGroups).where(like(healthCheckGroups.name, `${marker}%`)),
    );
    expect(alphaGroups.map((g) => g.name)).toEqual([`${marker}-alpha-group`]);
  });

  it("scopes child tables through their parent (logs, pauses, shares, group members)", async () => {
    const readChildren = (householdId: string, ids: { checkIds: string[]; groupIds: string[] }) =>
      withHouseholdContext(db, householdId, async (tx) => ({
        logs: await tx.select({ id: healthCheckLogs.id }).from(healthCheckLogs).where(inArray(healthCheckLogs.checkId, ids.checkIds)),
        pauses: await tx.select({ id: healthCheckPauses.id }).from(healthCheckPauses).where(inArray(healthCheckPauses.checkId, ids.checkIds)),
        shares: await tx.select({ id: healthCheckShares.checkId }).from(healthCheckShares).where(inArray(healthCheckShares.checkId, ids.checkIds)),
        members: await tx
          .select({ id: healthCheckGroupMembers.groupId })
          .from(healthCheckGroupMembers)
          .where(inArray(healthCheckGroupMembers.groupId, ids.groupIds)),
      }));

    const both = { checkIds: [alpha.checkId, beta.checkId], groupIds: [alpha.groupId, beta.groupId] };
    const asAlpha = await readChildren(alpha.householdId, both);
    expect(asAlpha.logs).toHaveLength(1);
    expect(asAlpha.pauses).toHaveLength(1);
    expect(asAlpha.shares).toHaveLength(1);
    expect(asAlpha.members).toHaveLength(1);

    const asBeta = await readChildren(beta.householdId, both);
    expect(asBeta.logs).toHaveLength(1);
    expect(asBeta.pauses).toHaveLength(1);
    expect(asBeta.shares).toHaveLength(1);
    expect(asBeta.members).toHaveLength(1);

    // Asking for only the other tenant's rows returns nothing.
    const alphaAskingForBeta = await readChildren(alpha.householdId, {
      checkIds: [beta.checkId],
      groupIds: [beta.groupId],
    });
    expect(alphaAskingForBeta.logs).toHaveLength(0);
    expect(alphaAskingForBeta.pauses).toHaveLength(0);
    expect(alphaAskingForBeta.shares).toHaveLength(0);
    expect(alphaAskingForBeta.members).toHaveLength(0);
  });

  it("returns nothing without a household context", async () => {
    const rows = await db
      .select({ id: healthChecks.id })
      .from(healthChecks)
      .where(like(healthChecks.name, `${marker}%`));
    expect(rows).toHaveLength(0);
  });

  it("rejects cross-tenant writes", async () => {
    await expect(
      withHouseholdContext(db, alpha.householdId, (tx) =>
        tx.insert(healthChecks).values({
          householdId: beta.householdId,
          memberId: beta.memberId,
          name: `${marker}-evil`,
          eventType: "vitals",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withHouseholdContext(db, alpha.householdId, (tx) =>
        tx.insert(healthCheckLogs).values({
          checkId: beta.checkId,
          scheduledAt: new Date("2026-10-03T13:00:00.000Z"),
          status: "done",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withHouseholdContext(db, alpha.householdId, (tx) =>
        tx.insert(healthCheckReminderSent).values({
          checkId: beta.checkId,
          scheduledAt: new Date("2026-10-03T13:00:00.000Z"),
          offsetMinutes: 0,
        }),
      ),
    ).rejects.toThrow();

    // An update that targets the other tenant's row matches nothing.
    await withHouseholdContext(db, alpha.householdId, (tx) =>
      tx.update(healthChecks).set({ name: `${marker}-hijack` }).where(eq(healthChecks.id, beta.checkId)),
    );
    const [betaCheck] = await withHouseholdContext(db, beta.householdId, (tx) =>
      tx.select({ name: healthChecks.name }).from(healthChecks).where(eq(healthChecks.id, beta.checkId)),
    );
    expect(betaCheck?.name).toBe(`${marker}-beta-bp`);
  });

  it("lets the worker scan context see every tenant's checks", async () => {
    const rows = await withWorkerScanContext(db, (tx) =>
      tx.select({ householdId: healthChecks.householdId }).from(healthChecks).where(like(healthChecks.name, `${marker}%`)),
    );
    expect(new Set(rows.map((r) => r.householdId))).toEqual(new Set([alpha.householdId, beta.householdId]));
  });

  it("enforces the DB constraints", async () => {
    // A medication dose is not a check.
    await expect(
      withHouseholdContext(db, alpha.householdId, (tx) =>
        tx.insert(healthChecks).values({
          householdId: alpha.householdId,
          memberId: alpha.memberId,
          name: `${marker}-med`,
          eventType: "medication",
        }),
      ),
    ).rejects.toThrow();

    // As-needed kinds have no due time.
    await expect(
      withHouseholdContext(db, alpha.householdId, (tx) =>
        tx.insert(healthChecks).values({
          householdId: alpha.householdId,
          memberId: alpha.memberId,
          name: `${marker}-prn`,
          eventType: "vitals",
          scheduleKind: "prn",
        }),
      ),
    ).rejects.toThrow();

    // One log per check per scheduled instant.
    await expect(
      withHouseholdContext(db, alpha.householdId, (tx) =>
        tx.insert(healthCheckLogs).values({
          checkId: alpha.checkId,
          scheduledAt: new Date("2026-10-02T13:00:00.000Z"),
          status: "skipped",
        }),
      ),
    ).rejects.toThrow();

    const logs = await withHouseholdContext(db, alpha.householdId, (tx) =>
      tx
        .select({ status: healthCheckLogs.status })
        .from(healthCheckLogs)
        .where(and(eq(healthCheckLogs.checkId, alpha.checkId))),
    );
    expect(logs).toEqual([{ status: "done" }]);
  });
});
