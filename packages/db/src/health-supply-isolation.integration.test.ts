import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb, withHouseholdContext, withWorkerScanContext } from "./index.js";
import {
  healthMedicationRefillEvents,
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
  healthPharmacies,
  healthSupplySettings,
  householdMembers,
  households,
} from "./schema/index.js";
import type { Database } from "./client.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const maybeDescribe = TEST_URL ? describe : describe.skip;

const RLS_VIOLATION = "42501";
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

/** Medication supply and pharmacies (WHO-413, migration 0087): RLS isolation + DB constraints. */
maybeDescribe("health supply tenant isolation (integration)", () => {
  const marker = `supply-iso-${Date.now()}`;
  let db: Database;

  type Tenant = { householdId: string; memberId: string; medicationId: string; pharmacyId: string };
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

      const [medication] = await tx
        .insert(healthMedications)
        .values({ householdId: household.id, memberId: member.id, name: `${marker}-${label}-med` })
        .returning({ id: healthMedications.id });
      const [pharmacy] = await tx
        .insert(healthPharmacies)
        .values({ householdId: household.id, name: `${marker}-${label}-pharmacy` })
        .returning({ id: healthPharmacies.id });

      await tx.insert(healthMedicationSupply).values({
        medicationId: medication!.id,
        pharmacyId: pharmacy!.id,
        runsOutOn: "2026-11-15",
        estimatedOn: "2026-10-05",
        outsideDays: 10,
        organizerDaysCounted: 31,
        revision: 1,
      });
      await tx.insert(healthMedicationSupplyRevisions).values({
        medicationId: medication!.id,
        revision: 1,
        source: "manual",
        runsOutOn: "2026-11-15",
        estimatedOn: "2026-10-05",
        outsideDays: 10,
        organizerDaysCounted: 31,
      });
      await tx
        .insert(healthMedicationRefillEvents)
        .values({ medicationId: medication!.id, kind: "requested", pharmacyId: pharmacy!.id });
      await tx.insert(healthSupplySettings).values({ memberId: member.id, householdId: household.id, defaultLeadDays: 5 });

      return { householdId: household.id, memberId: member.id, medicationId: medication!.id, pharmacyId: pharmacy!.id };
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
    // Supply, revisions and refill events cascade from the medication; settings stay with the
    // seeded members, so remove the ones this run created.
    await withWorkerScanContext(db, async (tx) => {
      await tx.delete(healthMedications).where(like(healthMedications.name, `${marker}%`));
      await tx.delete(healthPharmacies).where(like(healthPharmacies.name, `${marker}%`));
      for (const t of [alpha, beta]) {
        if (t) await tx.delete(healthSupplySettings).where(eq(healthSupplySettings.memberId, t.memberId));
      }
    });
    await closeDb(db);
  });

  it("scopes pharmacies to the active household", async () => {
    const names = (householdId: string) =>
      withHouseholdContext(db, householdId, (tx) =>
        tx.select({ name: healthPharmacies.name }).from(healthPharmacies).where(like(healthPharmacies.name, `${marker}%`)),
      );
    expect((await names(alpha.householdId)).map((p) => p.name)).toEqual([`${marker}-alpha-pharmacy`]);
    expect((await names(beta.householdId)).map((p) => p.name)).toEqual([`${marker}-beta-pharmacy`]);
  });

  it("scopes supply, revisions, refill events and settings, and returns the right rows", async () => {
    const read = (householdId: string, medicationIds: string[], memberIds: string[]) =>
      withHouseholdContext(db, householdId, async (tx) => ({
        supply: await tx
          .select({ id: healthMedicationSupply.medicationId })
          .from(healthMedicationSupply)
          .where(inArray(healthMedicationSupply.medicationId, medicationIds)),
        revisions: await tx
          .select({ id: healthMedicationSupplyRevisions.medicationId })
          .from(healthMedicationSupplyRevisions)
          .where(inArray(healthMedicationSupplyRevisions.medicationId, medicationIds)),
        events: await tx
          .select({ id: healthMedicationRefillEvents.medicationId })
          .from(healthMedicationRefillEvents)
          .where(inArray(healthMedicationRefillEvents.medicationId, medicationIds)),
        settings: await tx
          .select({ id: healthSupplySettings.memberId })
          .from(healthSupplySettings)
          .where(inArray(healthSupplySettings.memberId, memberIds)),
      }));

    for (const [tenant, other] of [
      [alpha, beta],
      [beta, alpha],
    ] as const) {
      // Asking for both tenants' ids returns exactly the caller's rows, not just "something".
      const both = await read(tenant.householdId, [alpha.medicationId, beta.medicationId], [alpha.memberId, beta.memberId]);
      expect(both.supply).toEqual([{ id: tenant.medicationId }]);
      expect(both.revisions).toEqual([{ id: tenant.medicationId }]);
      expect(both.events).toEqual([{ id: tenant.medicationId }]);
      expect(both.settings).toEqual([{ id: tenant.memberId }]);

      // Asking for only the other tenant's ids returns nothing.
      const foreign = await read(tenant.householdId, [other.medicationId], [other.memberId]);
      expect(foreign.supply).toHaveLength(0);
      expect(foreign.revisions).toHaveLength(0);
      expect(foreign.events).toHaveLength(0);
      expect(foreign.settings).toHaveLength(0);
    }
  });

  it("returns nothing without a household context", async () => {
    expect(await db.select({ id: healthPharmacies.id }).from(healthPharmacies).where(like(healthPharmacies.name, `${marker}%`))).toHaveLength(0);
    expect(await db.select({ id: healthMedicationSupply.medicationId }).from(healthMedicationSupply)).toHaveLength(0);
  });

  it("rejects cross-tenant writes, including pointing your own medication at someone else's pharmacy", async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      [
        "a pharmacy in another household",
        () =>
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx.insert(healthPharmacies).values({ householdId: beta.householdId, name: `${marker}-evil` }),
          ),
      ],
      [
        "supply for another household's medication",
        () =>
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx.insert(healthMedicationSupply).values({ medicationId: beta.medicationId }),
          ),
      ],
      [
        "a revision for another household's medication",
        () =>
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx.insert(healthMedicationSupplyRevisions).values({
              medicationId: beta.medicationId,
              revision: 9,
              source: "manual",
              runsOutOn: "2026-12-01",
              estimatedOn: "2026-10-05",
              outsideDays: 1,
              organizerDaysCounted: 0,
            }),
          ),
      ],
      [
        "a refill event for another household's medication",
        () =>
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx.insert(healthMedicationRefillEvents).values({ medicationId: beta.medicationId, kind: "requested" }),
          ),
      ],
      [
        "a refill event for your medication that names another household's pharmacy",
        () =>
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx
              .insert(healthMedicationRefillEvents)
              .values({ medicationId: alpha.medicationId, kind: "requested", pharmacyId: beta.pharmacyId }),
          ),
      ],
      [
        "settings for another household's member",
        () =>
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx.insert(healthSupplySettings).values({ memberId: beta.memberId, householdId: beta.householdId }),
          ),
      ],
      [
        "settings that claim your household but another household's member",
        () =>
          withHouseholdContext(db, alpha.householdId, (tx) =>
            tx.insert(healthSupplySettings).values({ memberId: beta.memberId, householdId: alpha.householdId }),
          ),
      ],
    ];
    for (const [label, write] of cases) expect(await sqlState(write()), label).toBe(RLS_VIOLATION);

    // Re-pointing your own supply row at someone else's pharmacy is refused on update too.
    expect(
      await sqlState(
        withHouseholdContext(db, alpha.householdId, (tx) =>
          tx.update(healthMedicationSupply).set({ pharmacyId: beta.pharmacyId }).where(eq(healthMedicationSupply.medicationId, alpha.medicationId)),
        ),
      ),
    ).toBe(RLS_VIOLATION);

    // Nothing leaked in: each tenant still has exactly its own pharmacy and supply row.
    const betaPharmacies = await withHouseholdContext(db, beta.householdId, (tx) =>
      tx.select({ name: healthPharmacies.name }).from(healthPharmacies).where(like(healthPharmacies.name, `${marker}%`)),
    );
    expect(betaPharmacies.map((p) => p.name)).toEqual([`${marker}-beta-pharmacy`]);
  });

  it("cannot update or delete another tenant's rows", async () => {
    await withHouseholdContext(db, alpha.householdId, async (tx) => {
      await tx.update(healthPharmacies).set({ notes: "tampered" }).where(eq(healthPharmacies.id, beta.pharmacyId));
      await tx.update(healthMedicationSupply).set({ leadDays: 1 }).where(eq(healthMedicationSupply.medicationId, beta.medicationId));
      await tx.delete(healthMedicationRefillEvents).where(eq(healthMedicationRefillEvents.medicationId, beta.medicationId));
    });
    const [pharmacy] = await withHouseholdContext(db, beta.householdId, (tx) =>
      tx.select({ notes: healthPharmacies.notes }).from(healthPharmacies).where(eq(healthPharmacies.id, beta.pharmacyId)),
    );
    const [supply] = await withHouseholdContext(db, beta.householdId, (tx) =>
      tx.select({ leadDays: healthMedicationSupply.leadDays }).from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, beta.medicationId)),
    );
    const events = await withHouseholdContext(db, beta.householdId, (tx) =>
      tx.select({ id: healthMedicationRefillEvents.id }).from(healthMedicationRefillEvents).where(eq(healthMedicationRefillEvents.medicationId, beta.medicationId)),
    );
    expect(pharmacy?.notes).toBeNull();
    expect(supply?.leadDays).toBeNull();
    expect(events).toHaveLength(1);
  });

  it("lets the worker scan see every tenant", async () => {
    const rows = await withWorkerScanContext(db, (tx) =>
      tx.select({ id: healthMedicationSupply.medicationId }).from(healthMedicationSupply).where(inArray(healthMedicationSupply.medicationId, [alpha.medicationId, beta.medicationId])),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([alpha.medicationId, beta.medicationId].sort());
  });

  describe("constraints", () => {
    const inAlpha = <T>(fn: (tx: Parameters<Parameters<typeof withHouseholdContext>[2]>[0]) => Promise<T>) =>
      withHouseholdContext(db, alpha.householdId, fn);

    /** A second medication of Alpha's, so inserts do not collide with the seeded supply row. */
    async function freshMedication() {
      const [m] = await inAlpha((tx) =>
        tx
          .insert(healthMedications)
          .values({ householdId: alpha.householdId, memberId: alpha.memberId, name: `${marker}-extra` })
          .returning({ id: healthMedications.id }),
      );
      return m!.id;
    }

    it("allows one supply row per medication", async () => {
      expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: alpha.medicationId })))).toBe(UNIQUE_VIOLATION);
    });

    it("keeps lead days within 0 to 90, here and on the person-wide setting", async () => {
      const med = await freshMedication();
      for (const leadDays of [-1, 91]) {
        expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: med, leadDays }))), `lead ${leadDays}`).toBe(CHECK_VIOLATION);
      }
      for (const leadDays of [0, 90]) {
        const m = await freshMedication();
        expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: m, leadDays }))), `lead ${leadDays}`).toBeNull();
      }
      for (const defaultLeadDays of [-1, 91]) {
        expect(
          await sqlState(inAlpha((tx) => tx.update(healthSupplySettings).set({ defaultLeadDays }).where(eq(healthSupplySettings.memberId, alpha.memberId)))),
          `default ${defaultLeadDays}`,
        ).toBe(CHECK_VIOLATION);
      }
    });

    it("refuses negative day counts", async () => {
      const med = await freshMedication();
      expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: med, outsideDays: -1 })))).toBe(CHECK_VIOLATION);
      expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: med, organizerDaysCounted: -1 })))).toBe(CHECK_VIOLATION);
    });

    it("requires an estimate to carry both its date and the day it was made, and a revision", async () => {
      const med = await freshMedication();
      expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: med, runsOutOn: "2026-12-01", revision: 1 })))).toBe(CHECK_VIOLATION);
      expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: med, estimatedOn: "2026-10-05" })))).toBe(CHECK_VIOLATION);
      expect(
        await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: med, runsOutOn: "2026-12-01", estimatedOn: "2026-10-05", revision: 0 }))),
      ).toBe(CHECK_VIOLATION);
      expect(
        await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupply).values({ medicationId: med, runsOutOn: "2026-12-01", estimatedOn: "2026-10-05", revision: 1 }))),
      ).toBeNull();
    });

    it("keeps one revision number per medication and only known sources and event kinds", async () => {
      const dup = {
        medicationId: alpha.medicationId,
        revision: 1,
        source: "manual" as const,
        runsOutOn: "2026-12-01",
        estimatedOn: "2026-10-05",
        outsideDays: 1,
        organizerDaysCounted: 0,
      };
      expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupplyRevisions).values(dup)))).toBe(UNIQUE_VIOLATION);
      expect(
        await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupplyRevisions).values({ ...dup, revision: 2, source: "guess" as never }))),
      ).toBe(CHECK_VIOLATION);
      expect(await sqlState(inAlpha((tx) => tx.insert(healthMedicationSupplyRevisions).values({ ...dup, revision: 2, outsideDays: -1 })))).toBe(CHECK_VIOLATION);
      expect(
        await sqlState(inAlpha((tx) => tx.insert(healthMedicationRefillEvents).values({ medicationId: alpha.medicationId, kind: "shipped" as never }))),
      ).toBe(CHECK_VIOLATION);
    });

    it("keeps one settings row per person", async () => {
      expect(
        await sqlState(inAlpha((tx) => tx.insert(healthSupplySettings).values({ memberId: alpha.memberId, householdId: alpha.householdId }))),
      ).toBe(UNIQUE_VIOLATION);
    });

    it("cascades from the medication, and a deleted pharmacy only clears the references to it", async () => {
      const med = await freshMedication();
      const pharmacyId = await inAlpha(async (tx) => {
        const [p] = await tx.insert(healthPharmacies).values({ householdId: alpha.householdId, name: `${marker}-doomed` }).returning({ id: healthPharmacies.id });
        await tx.insert(healthMedicationSupply).values({ medicationId: med, pharmacyId: p!.id });
        await tx.insert(healthMedicationRefillEvents).values({ medicationId: med, kind: "requested", pharmacyId: p!.id });
        return p!.id;
      });

      await inAlpha((tx) => tx.delete(healthPharmacies).where(eq(healthPharmacies.id, pharmacyId)));
      const [supply] = await inAlpha((tx) => tx.select({ pharmacyId: healthMedicationSupply.pharmacyId }).from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, med)));
      const [event] = await inAlpha((tx) => tx.select({ pharmacyId: healthMedicationRefillEvents.pharmacyId }).from(healthMedicationRefillEvents).where(eq(healthMedicationRefillEvents.medicationId, med)));
      expect(supply?.pharmacyId).toBeNull();
      expect(event?.pharmacyId).toBeNull();

      await inAlpha((tx) => tx.delete(healthMedications).where(eq(healthMedications.id, med)));
      expect(await inAlpha((tx) => tx.select().from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, med)))).toHaveLength(0);
      expect(await inAlpha((tx) => tx.select().from(healthMedicationRefillEvents).where(eq(healthMedicationRefillEvents.medicationId, med)))).toHaveLength(0);
    });
  });
});
