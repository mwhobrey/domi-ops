import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, createDb, withHouseholdContext, withSystemContext, withWorkerScanContext } from "./index.js";
import {
  healthMedications,
  healthOrganizerPlans,
  healthPharmacies,
  healthSupplyFillReminderSent,
  healthSupplyRefillReminderSent,
  householdMembers,
  households,
  users,
} from "./schema/index.js";
import type { Database } from "./client.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const RLS_VIOLATION = "42501";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

async function sqlState(write: Promise<unknown>): Promise<string | null> {
  try {
    await write;
    return null;
  } catch (err) {
    return (err as { cause?: { code?: string } }).cause?.code ?? "unknown";
  }
}

/** The tables WHO-434 leaves the worker scan context able to read: the scheduler tick's, and nothing else of this feature. */
const READ_BY_THE_TICK = ["health_medication_supply", "health_organizer_plans"];
const FEATURE_TABLES = [
  "health_pharmacies",
  "health_medication_supply",
  "health_medication_supply_revisions",
  "health_medication_refill_events",
  "health_supply_settings",
  "health_medication_dose_quantities",
  "health_organizer_plans",
  "health_organizer_compartments",
  "health_organizer_time_map",
  "health_organizer_plan_caregivers",
  "health_organizer_occurrences",
  "health_organizer_occurrence_events",
  "health_organizer_sessions",
  "health_organizer_session_fills",
  "health_supply_fill_reminder_sent",
  "health_supply_refill_reminder_sent",
];

const featureTables = sql.join(FEATURE_TABLES.map((t) => sql`${t}`), sql`, `);

/**
 * Fill and refill reminder bookkeeping (WHO-432, migration 0090) and how far the worker can reach into this feature's
 * tables (WHO-434, migration 0091). Runs as the app role, which is subject to row level security; it builds its own two
 * households and removes them afterwards.
 */
maybeDescribe("health supply reminders tenant isolation (integration)", () => {
  const marker = `supply-rem-${Date.now()}`;
  let db: Database;

  type Tenant = { householdId: string; userId: string; memberId: string; medicationId: string; planId: string; pharmacyId: string };
  let alpha: Tenant;
  let beta: Tenant;
  const householdIds: string[] = [];
  const userIds: string[] = [];

  async function seed(label: string): Promise<Tenant> {
    const base = await withSystemContext(db, async (tx) => {
      const [h] = await tx.insert(households).values({ name: `${marker}-${label}`, slug: `${marker}-${label}` }).returning({ id: households.id });
      const [u] = await tx.insert(users).values({ username: `${marker}-${label}` }).returning({ id: users.id });
      const [m] = await tx.insert(householdMembers).values({ householdId: h!.id, userId: u!.id, role: "owner" }).returning({ id: householdMembers.id });
      householdIds.push(h!.id);
      userIds.push(u!.id);
      return { householdId: h!.id, userId: u!.id, memberId: m!.id };
    });
    return withHouseholdContext(db, base.householdId, async (tx) => {
      const [med] = await tx.insert(healthMedications).values({ householdId: base.householdId, memberId: base.memberId, name: `${marker}-${label}-med` }).returning({ id: healthMedications.id });
      const [plan] = await tx
        .insert(healthOrganizerPlans)
        .values({ householdId: base.householdId, memberId: base.memberId, scheduleKind: "every_n_days", everyN: 30, anchorDate: "2001-01-01" })
        .returning({ id: healthOrganizerPlans.id });
      const [pharmacy] = await tx.insert(healthPharmacies).values({ householdId: base.householdId, name: `${marker}-${label}-pharmacy` }).returning({ id: healthPharmacies.id });
      return { ...base, medicationId: med!.id, planId: plan!.id, pharmacyId: pharmacy!.id };
    });
  }

  const inAlpha = <T>(fn: Parameters<typeof withHouseholdContext<T>>[2]) => withHouseholdContext(db, alpha.householdId, fn);
  const inBeta = <T>(fn: Parameters<typeof withHouseholdContext<T>>[2]) => withHouseholdContext(db, beta.householdId, fn);

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    alpha = await seed("alpha");
    beta = await seed("beta");
    await inAlpha((tx) => tx.insert(healthSupplyFillReminderSent).values({ planId: alpha.planId, occurrenceDate: "2026-10-06", userId: alpha.userId }));
    await inAlpha((tx) => tx.insert(healthSupplyRefillReminderSent).values({ medicationId: alpha.medicationId, revision: 1, kind: "refill", userId: alpha.userId }));
    await inBeta((tx) => tx.insert(healthSupplyFillReminderSent).values({ planId: beta.planId, occurrenceDate: "2026-10-06", userId: beta.userId }));
    await inBeta((tx) => tx.insert(healthSupplyRefillReminderSent).values({ medicationId: beta.medicationId, revision: 1, kind: "refill", userId: beta.userId }));
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdIds.length) await tx.delete(households).where(inArray(households.id, householdIds));
      if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
    });
    await closeDb(db);
  });

  const fillRows = (run: typeof inAlpha) => run((tx) => tx.select().from(healthSupplyFillReminderSent));
  const refillRows = (run: typeof inAlpha) => run((tx) => tx.select().from(healthSupplyRefillReminderSent));

  it("shows each household only its own sent reminders", async () => {
    expect((await fillRows(inAlpha)).map((r) => r.planId)).toEqual([alpha.planId]);
    expect((await fillRows(inBeta)).map((r) => r.planId)).toEqual([beta.planId]);
    expect((await refillRows(inAlpha)).map((r) => r.medicationId)).toEqual([alpha.medicationId]);
    expect((await refillRows(inBeta)).map((r) => r.medicationId)).toEqual([beta.medicationId]);
  });

  it("shows nothing without a household context", async () => {
    expect(await db.select().from(healthSupplyFillReminderSent).where(inArray(healthSupplyFillReminderSent.planId, [alpha.planId, beta.planId]))).toHaveLength(0);
    expect(await db.select().from(healthSupplyRefillReminderSent).where(inArray(healthSupplyRefillReminderSent.medicationId, [alpha.medicationId, beta.medicationId]))).toHaveLength(0);
  });

  it("refuses to record a reminder for another household's plan or medication, and an update or delete reaches nothing of theirs", async () => {
    expect(await sqlState(inAlpha((tx) => tx.insert(healthSupplyFillReminderSent).values({ planId: beta.planId, occurrenceDate: "2026-11-05", userId: alpha.userId })))).toBe(RLS_VIOLATION);
    expect(await sqlState(inAlpha((tx) => tx.insert(healthSupplyRefillReminderSent).values({ medicationId: beta.medicationId, revision: 2, kind: "waiting", userId: alpha.userId })))).toBe(RLS_VIOLATION);
    // A control: the same insert for its own plan is fine.
    expect(await sqlState(inAlpha((tx) => tx.insert(healthSupplyFillReminderSent).values({ planId: alpha.planId, occurrenceDate: "2026-11-05", userId: alpha.userId })))).toBeNull();

    await inAlpha((tx) => tx.update(healthSupplyFillReminderSent).set({ occurrenceDate: "2030-01-01" }).where(eq(healthSupplyFillReminderSent.planId, beta.planId)));
    await inAlpha((tx) => tx.delete(healthSupplyRefillReminderSent).where(eq(healthSupplyRefillReminderSent.medicationId, beta.medicationId)));
    expect((await fillRows(inBeta)).map((r) => r.occurrenceDate)).toEqual(["2026-10-06"]);
    expect(await refillRows(inBeta)).toHaveLength(1);
  });

  describe("what keeps a reminder from going twice", () => {
    it("allows one fill reminder per appointment and person", async () => {
      expect(await sqlState(inAlpha((tx) => tx.insert(healthSupplyFillReminderSent).values({ planId: alpha.planId, occurrenceDate: "2026-10-06", userId: alpha.userId })))).toBe(UNIQUE_VIOLATION);
      // The conflict-free claim the scan makes records nothing and returns nothing.
      const claimed = await inAlpha((tx) =>
        tx
          .insert(healthSupplyFillReminderSent)
          .values({ planId: alpha.planId, occurrenceDate: "2026-10-06", userId: alpha.userId })
          .onConflictDoNothing()
          .returning({ id: healthSupplyFillReminderSent.id }),
      );
      expect(claimed).toHaveLength(0);
    });

    it("allows one refill reminder per estimate revision, kind and person, and lets a new revision or the other kind through", async () => {
      const claim = (revision: number, kind: "refill" | "waiting") =>
        inAlpha((tx) => tx.insert(healthSupplyRefillReminderSent).values({ medicationId: alpha.medicationId, revision, kind, userId: alpha.userId }));
      expect(await sqlState(claim(1, "refill"))).toBe(UNIQUE_VIOLATION);
      expect(await sqlState(claim(2, "refill"))).toBeNull();
      expect(await sqlState(claim(1, "waiting"))).toBeNull();
    });

    it("knows only the two kinds of refill reminder", async () => {
      expect(await sqlState(inAlpha((tx) => tx.insert(healthSupplyRefillReminderSent).values({ medicationId: alpha.medicationId, revision: 9, kind: "nagging" as never, userId: alpha.userId })))).toBe(CHECK_VIOLATION);
    });
  });

  it("goes with the plan, the medication and the person it was for", async () => {
    const fk = async (table: string, parent: string) => {
      const rows = await db.execute<{ onDelete: string }>(sql`
        select confdeltype as "onDelete" from pg_constraint
        where conrelid = ${table}::regclass and confrelid = ${parent}::regclass and contype = 'f'
      `);
      return [...rows].map((r) => r.onDelete);
    };
    expect(await fk("health_supply_fill_reminder_sent", "health_organizer_plans")).toEqual(["c"]);
    expect(await fk("health_supply_fill_reminder_sent", "users")).toEqual(["c"]);
    expect(await fk("health_supply_refill_reminder_sent", "health_medications")).toEqual(["c"]);
    expect(await fk("health_supply_refill_reminder_sent", "users")).toEqual(["c"]);
  });

  describe("the worker's reach (WHO-434)", () => {
    it("is only the tables the scheduler's tick reads; the reminder job runs per household and needs no cross-tenant policy", async () => {
      const rows = await db.execute<{ tablename: string }>(sql`
        select tablename from pg_policies
        where schemaname = 'public' and policyname = 'worker_scan' and tablename in (${featureTables})
        order by tablename
      `);
      expect([...rows].map((r) => r.tablename)).toEqual(READ_BY_THE_TICK);
    });

    it("every one of this feature's tables is still behind household isolation", async () => {
      const rows = await db.execute<{ tablename: string }>(sql`
        select tablename from pg_policies
        where schemaname = 'public' and policyname = 'household_isolation' and tablename in (${featureTables})
      `);
      expect([...rows].map((r) => r.tablename).sort()).toEqual([...FEATURE_TABLES].sort());
    });

    it("sees the plans and estimates of every household, as the tick needs", async () => {
      const plans = await withWorkerScanContext(db, (tx) => tx.select({ id: healthOrganizerPlans.id }).from(healthOrganizerPlans).where(inArray(healthOrganizerPlans.id, [alpha.planId, beta.planId])));
      expect(plans.map((p) => p.id).sort()).toEqual([alpha.planId, beta.planId].sort());
    });

    it("sees nothing of the pharmacy directory or the sent reminders, and cannot record one", async () => {
      expect(await withWorkerScanContext(db, (tx) => tx.select().from(healthPharmacies).where(inArray(healthPharmacies.id, [alpha.pharmacyId, beta.pharmacyId])))).toHaveLength(0);
      expect(await withWorkerScanContext(db, (tx) => tx.select().from(healthSupplyFillReminderSent).where(inArray(healthSupplyFillReminderSent.planId, [alpha.planId, beta.planId])))).toHaveLength(0);
      expect(await sqlState(withWorkerScanContext(db, (tx) => tx.insert(healthSupplyFillReminderSent).values({ planId: alpha.planId, occurrenceDate: "2027-01-01", userId: alpha.userId })))).toBe(RLS_VIOLATION);
    });
  });
});
