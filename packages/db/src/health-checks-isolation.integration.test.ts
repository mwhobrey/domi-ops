import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb, withHouseholdContext, withWorkerScanContext } from "./index.js";
import {
  healthCheckGroupMembers,
  healthCheckGroupShares,
  healthCheckGroups,
  healthCheckLogs,
  healthCheckPauses,
  healthCheckReminderSent,
  healthCheckShares,
  healthChecks,
  healthEvents,
  householdMembers,
  households,
  users,
} from "./schema/index.js";
import type { Database } from "./client.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const maybeDescribe = TEST_URL ? describe : describe.skip;

const RLS_VIOLATION = "42501";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

/** SQLSTATE of the Postgres error behind a rejected write, or null when the write succeeded. */
async function sqlState(write: Promise<unknown>): Promise<string | null> {
  try {
    await write;
    return null;
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return code ?? "unknown";
  }
}

/** Scheduled health checks (WHO-379/380, migration 0085): RLS isolation + DB constraints. */
maybeDescribe("health checks tenant isolation (integration)", () => {
  const marker = `hc-iso-${Date.now()}`;
  let db: Database;

  type Tenant = {
    householdId: string;
    memberId: string;
    checkId: string;
    groupId: string;
    eventId: string;
  };
  let alpha: Tenant;
  let beta: Tenant;
  /** A second member of the Alpha household, with their own check. */
  let alphaSecond: { userId: string; memberId: string; checkId: string };

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
      const [event] = await tx
        .insert(healthEvents)
        .values({ householdId: household.id, memberId: member.id, type: "vitals", title: `${marker}-${label}-event` })
        .returning({ id: healthEvents.id });

      await tx
        .insert(healthCheckGroupMembers)
        .values({ groupId: group!.id, checkId: check!.id, memberId: member.id });
      await tx.insert(healthCheckShares).values({ checkId: check!.id, memberId: member.id });
      await tx.insert(healthCheckGroupShares).values({ groupId: group!.id, memberId: member.id });
      await tx.insert(healthCheckPauses).values({ checkId: check!.id });
      await tx.insert(healthCheckLogs).values({
        checkId: check!.id,
        scheduledAt: new Date("2026-10-02T13:00:00.000Z"),
        status: "done",
        healthEventId: event!.id,
      });

      return {
        householdId: household.id,
        memberId: member.id,
        checkId: check!.id,
        groupId: group!.id,
        eventId: event!.id,
      };
    });
  }

  async function seedSecondMember(householdId: string) {
    return withHouseholdContext(db, householdId, async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ username: `${marker}-second` })
        .returning({ id: users.id });
      const [member] = await tx
        .insert(householdMembers)
        .values({ householdId, userId: user!.id })
        .returning({ id: householdMembers.id });
      const [check] = await tx
        .insert(healthChecks)
        .values({
          householdId,
          memberId: member!.id,
          name: `${marker}-second-bp`,
          eventType: "vitals",
        })
        .returning({ id: healthChecks.id });
      return { userId: user!.id, memberId: member!.id, checkId: check!.id };
    });
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    alpha = await seedTenant("alpha-hosted", "alpha");
    beta = await seedTenant("beta-hosted", "beta");
    alphaSecond = await seedSecondMember(alpha.householdId);
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    // Children cascade from the check / group / event rows.
    await withWorkerScanContext(db, async (tx) => {
      await tx.delete(healthChecks).where(like(healthChecks.name, `${marker}%`));
      await tx.delete(healthCheckGroups).where(like(healthCheckGroups.name, `${marker}%`));
      await tx.delete(healthEvents).where(like(healthEvents.title, `${marker}%`));
      if (alphaSecond) {
        await tx.delete(householdMembers).where(eq(householdMembers.id, alphaSecond.memberId));
        await tx.delete(users).where(eq(users.id, alphaSecond.userId));
      }
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
    expect(alphaChecks.map((c) => c.name).sort()).toEqual([`${marker}-alpha-bp`, `${marker}-second-bp`]);
    expect(betaChecks.map((c) => c.name)).toEqual([`${marker}-beta-bp`]);

    const alphaGroups = await withHouseholdContext(db, alpha.householdId, (tx) =>
      tx.select({ name: healthCheckGroups.name }).from(healthCheckGroups).where(like(healthCheckGroups.name, `${marker}%`)),
    );
    expect(alphaGroups.map((g) => g.name)).toEqual([`${marker}-alpha-group`]);
  });

  it("scopes child tables through their parent, and returns the right rows", async () => {
    const readChildren = (householdId: string, checkIds: string[], groupIds: string[]) =>
      withHouseholdContext(db, householdId, async (tx) => ({
        logs: await tx.select({ checkId: healthCheckLogs.checkId }).from(healthCheckLogs).where(inArray(healthCheckLogs.checkId, checkIds)),
        pauses: await tx.select({ checkId: healthCheckPauses.checkId }).from(healthCheckPauses).where(inArray(healthCheckPauses.checkId, checkIds)),
        shares: await tx.select({ checkId: healthCheckShares.checkId }).from(healthCheckShares).where(inArray(healthCheckShares.checkId, checkIds)),
        groupMembers: await tx
          .select({ groupId: healthCheckGroupMembers.groupId, checkId: healthCheckGroupMembers.checkId })
          .from(healthCheckGroupMembers)
          .where(inArray(healthCheckGroupMembers.groupId, groupIds)),
        groupShares: await tx
          .select({ groupId: healthCheckGroupShares.groupId })
          .from(healthCheckGroupShares)
          .where(inArray(healthCheckGroupShares.groupId, groupIds)),
      }));

    const bothChecks = [alpha.checkId, beta.checkId];
    const bothGroups = [alpha.groupId, beta.groupId];

    // Each tenant asks for both tenants' ids and gets back only its own rows, not just one row.
    for (const [tenant, other] of [
      [alpha, beta],
      [beta, alpha],
    ] as const) {
      const rows = await readChildren(tenant.householdId, bothChecks, bothGroups);
      expect(rows.logs).toEqual([{ checkId: tenant.checkId }]);
      expect(rows.pauses).toEqual([{ checkId: tenant.checkId }]);
      expect(rows.shares).toEqual([{ checkId: tenant.checkId }]);
      expect(rows.groupMembers).toEqual([{ groupId: tenant.groupId, checkId: tenant.checkId }]);
      expect(rows.groupShares).toEqual([{ groupId: tenant.groupId }]);

      // Asking for only the other tenant's ids returns nothing.
      const foreign = await readChildren(tenant.householdId, [other.checkId], [other.groupId]);
      expect(foreign.logs).toHaveLength(0);
      expect(foreign.pauses).toHaveLength(0);
      expect(foreign.shares).toHaveLength(0);
      expect(foreign.groupMembers).toHaveLength(0);
      expect(foreign.groupShares).toHaveLength(0);
    }
  });

  it("returns nothing without a household context", async () => {
    const rows = await db
      .select({ id: healthChecks.id })
      .from(healthChecks)
      .where(like(healthChecks.name, `${marker}%`));
    expect(rows).toHaveLength(0);
  });

  it("rejects cross-tenant writes", async () => {
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthChecks).values({
            householdId: beta.householdId,
            memberId: beta.memberId,
            name: `${marker}-evil`,
            eventType: "vitals",
          }),
        ),
      ),
    ).toBe(RLS_VIOLATION);

    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckLogs).values({
            checkId: beta.checkId,
            scheduledAt: new Date("2026-10-03T13:00:00.000Z"),
            status: "done",
          }),
        ),
      ),
    ).toBe(RLS_VIOLATION);

    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckReminderSent).values({
            checkId: beta.checkId,
            scheduledAt: new Date("2026-10-03T13:00:00.000Z"),
            offsetMinutes: 0,
          }),
        ),
      ),
    ).toBe(RLS_VIOLATION);

    // An update that targets the other tenant's row matches nothing.
    await withHouseholdContext(db, alpha.householdId, (tx) =>
      tx.update(healthChecks).set({ name: `${marker}-hijack` }).where(eq(healthChecks.id, beta.checkId)),
    );
    const [betaCheck] = await withHouseholdContext(db, beta.householdId, (tx) =>
      tx.select({ name: healthChecks.name }).from(healthChecks).where(eq(healthChecks.id, beta.checkId)),
    );
    expect(betaCheck?.name).toBe(`${marker}-beta-bp`);
  });

  it("rejects links to another household's records (secondary references)", async () => {
    // A log for my own check that points at the other tenant's event.
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckLogs).values({
            checkId: alpha.checkId,
            scheduledAt: new Date("2026-10-04T13:00:00.000Z"),
            status: "done",
            healthEventId: beta.eventId,
          }),
        ),
      ),
    ).toBe(RLS_VIOLATION);

    // Positive control: the same insert with my own event is allowed.
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckLogs).values({
            checkId: alpha.checkId,
            scheduledAt: new Date("2026-10-04T13:00:00.000Z"),
            status: "done",
            healthEventId: alpha.eventId,
          }),
        ),
      ),
    ).toBeNull();

    // Sharing a check or group with a member of another household.
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckShares).values({ checkId: alpha.checkId, memberId: beta.memberId }),
        ),
      ),
    ).toBe(RLS_VIOLATION);
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckGroupShares).values({ groupId: alpha.groupId, memberId: beta.memberId }),
        ),
      ),
    ).toBe(RLS_VIOLATION);

    // A group of mine containing the other tenant's check.
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckGroupMembers).values({
            groupId: alpha.groupId,
            checkId: beta.checkId,
            memberId: alpha.memberId,
          }),
        ),
      ),
    ).toBe(RLS_VIOLATION);
  });

  it("only lets a group hold checks of the same member", async () => {
    // Same household, passes RLS, so only the composite foreign key can stop it.
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckGroupMembers).values({
            groupId: alpha.groupId,
            checkId: alphaSecond.checkId,
            memberId: alpha.memberId,
          }),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);

    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckGroupMembers).values({
            groupId: alpha.groupId,
            checkId: alphaSecond.checkId,
            memberId: alphaSecond.memberId,
          }),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("lets the worker scan context see every tenant's checks", async () => {
    const rows = await withWorkerScanContext(db, (tx) =>
      tx.select({ householdId: healthChecks.householdId }).from(healthChecks).where(like(healthChecks.name, `${marker}%`)),
    );
    expect(new Set(rows.map((r) => r.householdId))).toEqual(new Set([alpha.householdId, beta.householdId]));
  });

  it("enforces the DB constraints", async () => {
    // A medication dose is not a check.
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthChecks).values({
            householdId: alpha.householdId,
            memberId: alpha.memberId,
            name: `${marker}-med`,
            eventType: "medication",
          }),
        ),
      ),
    ).toBe(CHECK_VIOLATION);

    // As-needed kinds have no due time, for checks and for groups.
    for (const scheduleKind of ["prn", "otc"] as const) {
      expect(
        await sqlState(
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx.insert(healthChecks).values({
              householdId: alpha.householdId,
              memberId: alpha.memberId,
              name: `${marker}-${scheduleKind}`,
              eventType: "vitals",
              scheduleKind,
            }),
          ),
        ),
      ).toBe(CHECK_VIOLATION);
      expect(
        await sqlState(
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx.insert(healthCheckGroups).values({
              householdId: alpha.householdId,
              memberId: alpha.memberId,
              name: `${marker}-${scheduleKind}-group`,
              scheduleKind,
            }),
          ),
        ),
      ).toBe(CHECK_VIOLATION);
    }

    // One log per check per scheduled instant.
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.insert(healthCheckLogs).values({
            checkId: alpha.checkId,
            scheduledAt: new Date("2026-10-02T13:00:00.000Z"),
            status: "skipped",
          }),
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);

    const logs = await withHouseholdContext(db, alpha.householdId, (tx) =>
      tx
        .select({ status: healthCheckLogs.status })
        .from(healthCheckLogs)
        .where(eq(healthCheckLogs.checkId, alpha.checkId)),
    );
    expect(logs.every((l) => l.status === "done")).toBe(true);
  });
});
