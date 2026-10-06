import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  closeDb,
  createDb,
  healthMedicationSupply,
  healthMedications,
  healthOrganizerPlans,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import { fanOutSupplyReminderScans } from "./health-reminder-fanout.js";
import { householdScanJobId, type EnqueueHouseholdScan, type HouseholdScanJob } from "./household-scan-fanout.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

type Call = { job: HouseholdScanJob; householdId: string; jobId: string };

/**
 * The tick decides which households get a supply reminder job (WHO-432): those with a pill organizer or a medication
 * that has a supply estimate, and the health module. Other suites share the database, so every assertion looks only
 * at the households this suite created.
 */
maybeDescribe("supply reminder fan-out (integration)", () => {
  let db: Database;
  const hh: Record<string, string> = {};
  const member: Record<string, string> = {};
  const userIds: string[] = [];
  const ids = () => Object.values(hh);

  async function tick(now = new Date()): Promise<Call[]> {
    const calls: Call[] = [];
    const enqueue: EnqueueHouseholdScan = async (job, householdId, jobId) => {
      calls.push({ job, householdId, jobId });
    };
    await withWorkerScanContext(db, (tx) => fanOutSupplyReminderScans(tx, { enqueue, now }));
    return calls.filter((c) => ids().includes(c.householdId));
  }

  async function seed(key: string, modules: string[]) {
    await withSystemContext(db, async (tx) => {
      const [h] = await tx
        .insert(households)
        .values({ name: `supplyfan-${key}`, timezone: "UTC", modulesEnabled: JSON.stringify(modules) })
        .returning({ id: households.id });
      hh[key] = h!.id;
      const [u] = await tx
        .insert(users)
        .values({ email: `supplyfan-${key}-${randomUUID()}@test.local`, displayName: "Ally", emailVerified: true })
        .returning({ id: users.id });
      userIds.push(u!.id);
      const [m] = await tx.insert(householdMembers).values({ householdId: h!.id, userId: u!.id, role: "owner", name: "Ally" }).returning({ id: householdMembers.id });
      member[key] = m!.id;
    });
  }

  const plan = (key: string, over: Partial<typeof healthOrganizerPlans.$inferInsert> = {}) =>
    withHouseholdContext(db, hh[key]!, (tx) =>
      tx.insert(healthOrganizerPlans).values({ householdId: hh[key]!, memberId: member[key]!, scheduleKind: "every_n_days", everyN: 30, anchorDate: "2026-10-06", ...over }),
    );

  const estimate = (key: string, med: Partial<typeof healthMedications.$inferInsert> = {}, runsOutOn: string | null = "2026-10-26") =>
    withHouseholdContext(db, hh[key]!, async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({ householdId: hh[key]!, memberId: member[key]!, name: "FanMed", scheduleKind: "scheduled", scheduleJson: JSON.stringify({ times: ["08:00"] }), ...med })
        .returning({ id: healthMedications.id });
      await tx.insert(healthMedicationSupply).values({
        medicationId: m!.id,
        runsOutOn,
        estimatedOn: runsOutOn ? "2026-10-01" : null,
        outsideDays: runsOutOn ? 0 : null,
        organizerDaysCounted: runsOutOn ? 0 : null,
        revision: runsOutOn ? 1 : 0,
      });
    });

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    for (const key of ["plan", "estimate", "pausedEstimate", "noEstimate", "archivedPlan", "noModule", "empty"]) {
      await seed(key, key === "noModule" ? ["core"] : ["core", "health"]);
    }
    await plan("plan");
    await estimate("estimate");
    await estimate("pausedEstimate", { enabled: false });
    await estimate("noEstimate", {}, null); // a pharmacy or lead time was set, no run-out date
    await plan("archivedPlan", { archivedAt: new Date() });
    await plan("noModule");
    await estimate("noModule");
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (ids().length) await tx.delete(households).where(inArray(households.id, ids()));
      if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
    });
    await closeDb(db);
  });

  it("enqueues a job only for households with an organizer or a supply estimate, and the health module", async () => {
    const calls = await tick();
    expect(calls.map((c) => c.householdId).sort()).toEqual([hh.plan, hh.estimate].sort());
    expect(calls.every((c) => c.job === "health.supply.reminder.household")).toBe(true);
  });

  it("leaves out paused medications, medications without a run-out date, archived plans, households without the module and empty ones", async () => {
    const got = new Set((await tick()).map((c) => c.householdId));
    for (const key of ["pausedEstimate", "noEstimate", "archivedPlan", "noModule", "empty"]) expect(got.has(hh[key]!)).toBe(false);
  });

  it("gives each household one job per five minutes, so a double tick is harmless", async () => {
    const now = new Date("2026-10-06T14:02:00Z");
    const first = await tick(now);
    const second = await tick(new Date("2026-10-06T14:04:30Z"));
    const next = await tick(new Date("2026-10-06T14:06:00Z"));
    expect(first.map((c) => c.jobId).sort()).toEqual(second.map((c) => c.jobId).sort());
    expect(first[0]!.jobId).toBe(householdScanJobId("health.supply.reminder.household", first[0]!.householdId, now));
    expect(next.map((c) => c.jobId)).not.toEqual(first.map((c) => c.jobId));
  });
});
