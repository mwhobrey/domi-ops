import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  closeDb,
  createDb,
  healthChecks,
  healthMedicationGroups,
  healthMedications,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import { fanOutCheckReminderScans, fanOutMedReminderScans } from "./health-reminder-fanout.js";
import {
  HOUSEHOLD_SCAN_INTERVAL_MS,
  householdScanJobId,
  type EnqueueHouseholdScan,
  type HouseholdScanJob,
} from "./household-scan-fanout.js";

const WINDOW_MS = HOUSEHOLD_SCAN_INTERVAL_MS["health.check.reminder.household"];

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

type Call = { job: HouseholdScanJob; householdId: string; jobId: string };

/**
 * The tick decides which households get a reminder job (WHO-403). Other suites share the database,
 * so every assertion looks only at the households this suite created.
 */
maybeDescribe("health reminder fan-out (integration)", () => {
  let db: Database;
  const hh: Record<string, string> = {};
  const member: Record<string, string> = {};
  const userIds: string[] = [];

  const ids = () => Object.values(hh);

  /** Run a fan-out the way the worker does (cross-tenant) with a recording enqueue. */
  async function tick(
    fan: typeof fanOutMedReminderScans,
    opts: { now?: Date; failFor?: string } = {},
  ): Promise<{ calls: Call[]; result: number | Error }> {
    const calls: Call[] = [];
    const enqueue: EnqueueHouseholdScan = async (job, householdId, jobId) => {
      if (householdId === opts.failFor) throw new Error("redis down");
      calls.push({ job, householdId, jobId });
    };
    let result: number | Error;
    try {
      result = await withWorkerScanContext(db, (tx) => fan(tx, { enqueue, now: opts.now }));
    } catch (e) {
      result = e as Error;
    }
    return { calls: calls.filter((c) => ids().includes(c.householdId)), result };
  }

  const forHousehold = (calls: Call[], key: string) => calls.filter((c) => c.householdId === hh[key]);

  async function seed(key: string, modules: string[]) {
    await withSystemContext(db, async (tx) => {
      const [h] = await tx
        .insert(households)
        .values({ name: `fanout-${key}`, timezone: "UTC", modulesEnabled: JSON.stringify(modules) })
        .returning({ id: households.id });
      hh[key] = h.id;
      const [u] = await tx
        .insert(users)
        .values({ email: `fanout-${key}-${randomUUID()}@test.local`, displayName: "Ally", emailVerified: true })
        .returning({ id: users.id });
      userIds.push(u.id);
      const [m] = await tx
        .insert(householdMembers)
        .values({ householdId: h.id, userId: u.id, role: "owner", name: "Ally" })
        .returning({ id: householdMembers.id });
      member[key] = m.id;
    });
  }

  const med = (key: string, over: Partial<typeof healthMedications.$inferInsert> = {}) =>
    withHouseholdContext(db, hh[key]!, (tx) =>
      tx.insert(healthMedications).values({
        householdId: hh[key]!,
        memberId: member[key]!,
        name: "FanoutMed",
        scheduleKind: "scheduled",
        scheduleJson: JSON.stringify({ times: ["08:00"] }),
        ...over,
      }),
    );

  const check = (key: string, over: Partial<typeof healthChecks.$inferInsert> = {}) =>
    withHouseholdContext(db, hh[key]!, (tx) =>
      tx.insert(healthChecks).values({
        householdId: hh[key]!,
        memberId: member[key]!,
        name: "Fanout BP",
        eventType: "vitals",
        templateJson: JSON.stringify({ metrics: ["bp_systolic"] }),
        scheduleJson: JSON.stringify({ times: ["12:05"] }),
        ...over,
      }),
    );

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await seed("meds", ["core", "health"]); // an enabled medication
    await seed("pausedMed", ["core", "health"]); // only a paused medication
    await seed("checks", ["core", "health"]); // an enabled check
    await seed("pausedCheck", ["core", "health"]); // paused + deleted checks only
    await seed("noModule", ["core"]); // has both, but the health module is off
    await seed("empty", ["core", "health"]); // nothing to remind about
    await med("meds");
    await med("pausedMed", { enabled: false });
    await check("checks");
    await check("pausedCheck", { enabled: false });
    await check("pausedCheck", { name: "Gone", deletedAt: new Date() });
    await med("noModule");
    await check("noModule");
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (ids().length) await tx.delete(households).where(inArray(households.id, ids()));
      if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
    });
    await closeDb(db);
  });

  it("enqueues a medication job only for households with an enabled medication and the health module", async () => {
    const { calls, result } = await tick(fanOutMedReminderScans);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(calls.map((c) => c.householdId)).toEqual([hh.meds]);
    expect(calls[0]!.job).toBe("health.med.reminder.household");
  });

  it("enqueues a check job only for households with a live enabled check and the health module", async () => {
    const { calls } = await tick(fanOutCheckReminderScans);
    expect(calls.map((c) => c.householdId)).toEqual([hh.checks]);
    expect(calls[0]!.job).toBe("health.check.reminder.household");
  });

  it("enqueues for a household whose only reminders come from an enabled medication group", async () => {
    await withHouseholdContext(db, hh.empty!, (tx) =>
      tx.insert(healthMedicationGroups).values({
        householdId: hh.empty!,
        memberId: member.empty!,
        name: "Morning",
        scheduleJson: JSON.stringify({ times: ["08:00"] }),
      }),
    );
    const { calls } = await tick(fanOutMedReminderScans);
    expect(forHousehold(calls, "empty")).toHaveLength(1);
    await withHouseholdContext(db, hh.empty!, (tx) =>
      tx.delete(healthMedicationGroups).where(eq(healthMedicationGroups.householdId, hh.empty!)),
    );
  });

  it("gives a household the same job id for the whole 5 minute window and a new one in the next", async () => {
    const t0 = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS);
    const a = await tick(fanOutCheckReminderScans, { now: new Date(t0.getTime() + 1_000) });
    const b = await tick(fanOutCheckReminderScans, { now: new Date(t0.getTime() + WINDOW_MS - 1_000) });
    const c = await tick(fanOutCheckReminderScans, { now: new Date(t0.getTime() + WINDOW_MS + 1_000) });
    expect(a.calls[0]!.jobId).toBe(b.calls[0]!.jobId);
    expect(c.calls[0]!.jobId).not.toBe(a.calls[0]!.jobId);
    expect(a.calls[0]!.jobId).toBe(householdScanJobId("health.check.reminder.household", hh.checks!, t0));
    // BullMQ rejects custom ids containing ":".
    expect(a.calls[0]!.jobId).not.toContain(":");
  });

  it("keeps enqueuing the other households when one enqueue fails, then reports the failure", async () => {
    // Make two households due so there is something after the failing one.
    await check("meds");
    try {
      const { calls, result } = await tick(fanOutCheckReminderScans, { failFor: hh.checks });
      expect(forHousehold(calls, "meds")).toHaveLength(1);
      expect(forHousehold(calls, "checks")).toHaveLength(0);
      expect(result).toBeInstanceOf(AggregateError);
      expect((result as AggregateError).errors).toHaveLength(1);
    } finally {
      // Don't leak the extra check into other tests.
      await withHouseholdContext(db, hh.meds!, (tx) =>
        tx.delete(healthChecks).where(eq(healthChecks.householdId, hh.meds!)),
      );
    }
  });
});
