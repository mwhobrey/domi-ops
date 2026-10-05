import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb, withHouseholdContext, withWorkerScanContext } from "./index.js";
import {
  healthMedicationDoseQuantities,
  healthMedicationSupplyRevisions,
  healthMedications,
  healthOrganizerCompartments,
  healthOrganizerOccurrenceEvents,
  healthOrganizerOccurrences,
  healthOrganizerPlanCaregivers,
  healthOrganizerPlans,
  healthOrganizerSessionFills,
  healthOrganizerSessions,
  healthOrganizerTimeMap,
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

/** Plans carry no name, so this anchor date marks the ones these tests made (and clears leftovers). */
const SENTINEL_ANCHOR = "2001-01-01";

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

/** Pill organizers and filling sessions (WHO-414, migration 0088): RLS isolation + DB constraints. */
maybeDescribe("health organizer tenant isolation (integration)", () => {
  const marker = `org-iso-${Date.now()}`;
  let db: Database;

  type Tenant = {
    householdId: string;
    memberId: string;
    medicationId: string;
    planId: string;
    compartmentId: string;
    occurrenceId: string;
    sessionId: string;
    fillId: string;
  };
  let alpha: Tenant;
  let beta: Tenant;
  /** A second person in Alpha with a plan of their own, to prove rows cannot cross plans. */
  let alphaSecond: { userId: string; memberId: string; planId: string; compartmentId: string };

  const plan = (householdId: string, memberId: string, over: Partial<typeof healthOrganizerPlans.$inferInsert> = {}) => ({
    householdId,
    memberId,
    scheduleKind: "every_n_days" as const,
    everyN: 31,
    anchorDate: SENTINEL_ANCHOR,
    ...over,
  });

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
      const [p] = await tx
        .insert(healthOrganizerPlans)
        .values(plan(household.id, member.id))
        .returning({ id: healthOrganizerPlans.id });
      const [compartment] = await tx
        .insert(healthOrganizerCompartments)
        .values({ planId: p!.id, name: "Morning", position: 0 })
        .returning({ id: healthOrganizerCompartments.id });
      await tx.insert(healthOrganizerPlanCaregivers).values({ planId: p!.id, memberId: member.id });
      await tx.insert(healthOrganizerTimeMap).values({ planId: p!.id, doseTime: "08:00", compartmentId: compartment!.id });
      await tx.insert(healthMedicationDoseQuantities).values({ medicationId: medication!.id, doseTime: "08:00", quantityQuarters: 6 });
      const [occurrence] = await tx
        .insert(healthOrganizerOccurrences)
        .values({ planId: p!.id, occurrenceDate: "2026-10-05" })
        .returning({ id: healthOrganizerOccurrences.id });
      await tx.insert(healthOrganizerOccurrenceEvents).values({ occurrenceId: occurrence!.id, fromOutcome: "pending", toOutcome: "done" });
      const [session] = await tx
        .insert(healthOrganizerSessions)
        .values({ planId: p!.id, occurrenceId: occurrence!.id, coverageStart: "2026-10-05", fillLengthDays: 31, snapshotJson: "enc:{}", snapshotHash: "h1" })
        .returning({ id: healthOrganizerSessions.id });
      const [fill] = await tx
        .insert(healthOrganizerSessionFills)
        .values({ sessionId: session!.id, medicationId: medication!.id, coveredFrom: "2026-10-05", coveredTo: "2026-11-04", idempotencyKey: `${marker}-${label}` })
        .returning({ id: healthOrganizerSessionFills.id });

      return {
        householdId: household.id,
        memberId: member.id,
        medicationId: medication!.id,
        planId: p!.id,
        compartmentId: compartment!.id,
        occurrenceId: occurrence!.id,
        sessionId: session!.id,
        fillId: fill!.id,
      };
    });
  }

  async function seedSecondMember(householdId: string) {
    return withHouseholdContext(db, householdId, async (tx) => {
      const [user] = await tx.insert(users).values({ username: `${marker}-second` }).returning({ id: users.id });
      const [member] = await tx.insert(householdMembers).values({ householdId, userId: user!.id }).returning({ id: householdMembers.id });
      const [p] = await tx.insert(healthOrganizerPlans).values(plan(householdId, member!.id)).returning({ id: healthOrganizerPlans.id });
      const [c] = await tx
        .insert(healthOrganizerCompartments)
        .values({ planId: p!.id, name: "Night", position: 0 })
        .returning({ id: healthOrganizerCompartments.id });
      return { userId: user!.id, memberId: member!.id, planId: p!.id, compartmentId: c!.id };
    });
  }

  async function clearLeftovers() {
    await withWorkerScanContext(db, async (tx) => {
      // Children cascade from the plan and the medication.
      await tx.delete(healthOrganizerPlans).where(eq(healthOrganizerPlans.anchorDate, SENTINEL_ANCHOR));
      await tx.delete(healthMedications).where(like(healthMedications.name, "org-iso-%"));
    });
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await clearLeftovers();
    alpha = await seedTenant("alpha-hosted", "alpha");
    beta = await seedTenant("beta-hosted", "beta");
    alphaSecond = await seedSecondMember(alpha.householdId);
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await clearLeftovers();
    await withWorkerScanContext(db, async (tx) => {
      if (alphaSecond) {
        await tx.delete(householdMembers).where(eq(householdMembers.id, alphaSecond.memberId));
        await tx.delete(users).where(eq(users.id, alphaSecond.userId));
      }
    });
    await closeDb(db);
  });

  const inAlpha = <T>(fn: (tx: Parameters<Parameters<typeof withHouseholdContext>[2]>[0]) => Promise<T>) =>
    withHouseholdContext(db, alpha.householdId, fn);

  it("scopes plans to the active household", async () => {
    const mine = (householdId: string) =>
      withHouseholdContext(db, householdId, (tx) =>
        tx.select({ memberId: healthOrganizerPlans.memberId }).from(healthOrganizerPlans).where(eq(healthOrganizerPlans.anchorDate, SENTINEL_ANCHOR)),
      );
    expect((await mine(alpha.householdId)).map((r) => r.memberId).sort()).toEqual([alpha.memberId, alphaSecond.memberId].sort());
    expect((await mine(beta.householdId)).map((r) => r.memberId)).toEqual([beta.memberId]);
  });

  it("scopes every child table through its plan, medication or session, and returns the right rows", async () => {
    const read = (householdId: string, t: { plans: string[]; meds: string[]; occurrences: string[]; sessions: string[] }) =>
      withHouseholdContext(db, householdId, async (tx) => ({
        caregivers: await tx.select({ id: healthOrganizerPlanCaregivers.planId }).from(healthOrganizerPlanCaregivers).where(inArray(healthOrganizerPlanCaregivers.planId, t.plans)),
        compartments: await tx.select({ id: healthOrganizerCompartments.planId }).from(healthOrganizerCompartments).where(inArray(healthOrganizerCompartments.planId, t.plans)),
        timeMap: await tx.select({ id: healthOrganizerTimeMap.planId }).from(healthOrganizerTimeMap).where(inArray(healthOrganizerTimeMap.planId, t.plans)),
        quantities: await tx.select({ id: healthMedicationDoseQuantities.medicationId }).from(healthMedicationDoseQuantities).where(inArray(healthMedicationDoseQuantities.medicationId, t.meds)),
        occurrences: await tx.select({ id: healthOrganizerOccurrences.planId }).from(healthOrganizerOccurrences).where(inArray(healthOrganizerOccurrences.planId, t.plans)),
        events: await tx.select({ id: healthOrganizerOccurrenceEvents.occurrenceId }).from(healthOrganizerOccurrenceEvents).where(inArray(healthOrganizerOccurrenceEvents.occurrenceId, t.occurrences)),
        sessions: await tx.select({ id: healthOrganizerSessions.planId }).from(healthOrganizerSessions).where(inArray(healthOrganizerSessions.planId, t.plans)),
        fills: await tx.select({ id: healthOrganizerSessionFills.sessionId }).from(healthOrganizerSessionFills).where(inArray(healthOrganizerSessionFills.sessionId, t.sessions)),
      }));

    const both = {
      plans: [alpha.planId, beta.planId],
      meds: [alpha.medicationId, beta.medicationId],
      occurrences: [alpha.occurrenceId, beta.occurrenceId],
      sessions: [alpha.sessionId, beta.sessionId],
    };
    for (const [tenant, other] of [
      [alpha, beta],
      [beta, alpha],
    ] as const) {
      // Asking for both tenants' ids returns exactly the caller's rows.
      const rows = await read(tenant.householdId, both);
      expect(rows.caregivers).toEqual([{ id: tenant.planId }]);
      expect(rows.compartments).toEqual([{ id: tenant.planId }]);
      expect(rows.timeMap).toEqual([{ id: tenant.planId }]);
      expect(rows.quantities).toEqual([{ id: tenant.medicationId }]);
      expect(rows.occurrences).toEqual([{ id: tenant.planId }]);
      expect(rows.events).toEqual([{ id: tenant.occurrenceId }]);
      expect(rows.sessions).toEqual([{ id: tenant.planId }]);
      expect(rows.fills).toEqual([{ id: tenant.sessionId }]);

      // Asking for only the other tenant's ids returns nothing.
      const foreign = await read(tenant.householdId, {
        plans: [other.planId],
        meds: [other.medicationId],
        occurrences: [other.occurrenceId],
        sessions: [other.sessionId],
      });
      for (const [name, list] of Object.entries(foreign)) expect(list, name).toHaveLength(0);
    }
  });

  it("returns nothing without a household context", async () => {
    expect(await db.select({ id: healthOrganizerPlans.id }).from(healthOrganizerPlans).where(eq(healthOrganizerPlans.anchorDate, SENTINEL_ANCHOR))).toHaveLength(0);
    expect(await db.select({ id: healthOrganizerSessions.id }).from(healthOrganizerSessions)).toHaveLength(0);
    expect(await db.select({ id: healthOrganizerSessionFills.id }).from(healthOrganizerSessionFills)).toHaveLength(0);
  });

  it("rejects cross-tenant writes at every table", async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["a plan in another household", () => inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(beta.householdId, beta.memberId, { everyN: 5 })))],
      [
        "a plan in your household for another household's member",
        () => inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, beta.memberId))),
      ],
      [
        "a caregiver from another household on your plan",
        () => inAlpha((tx) => tx.insert(healthOrganizerPlanCaregivers).values({ planId: alpha.planId, memberId: beta.memberId })),
      ],
      [
        "a caregiver on another household's plan",
        () => inAlpha((tx) => tx.insert(healthOrganizerPlanCaregivers).values({ planId: beta.planId, memberId: alpha.memberId })),
      ],
      ["a compartment on another household's plan", () => inAlpha((tx) => tx.insert(healthOrganizerCompartments).values({ planId: beta.planId, name: "x", position: 3 }))],
      [
        "a time mapping on another household's plan",
        () => inAlpha((tx) => tx.insert(healthOrganizerTimeMap).values({ planId: beta.planId, doseTime: "12:00", compartmentId: beta.compartmentId })),
      ],
      [
        "a quantity on another household's medication",
        () => inAlpha((tx) => tx.insert(healthMedicationDoseQuantities).values({ medicationId: beta.medicationId, doseTime: "12:00", quantityQuarters: 4 })),
      ],
      ["an occurrence on another household's plan", () => inAlpha((tx) => tx.insert(healthOrganizerOccurrences).values({ planId: beta.planId, occurrenceDate: "2026-12-01" }))],
      [
        "an occurrence event on another household's occurrence",
        () => inAlpha((tx) => tx.insert(healthOrganizerOccurrenceEvents).values({ occurrenceId: beta.occurrenceId, fromOutcome: "pending", toOutcome: "skipped" })),
      ],
      [
        "a session on another household's plan",
        () => inAlpha((tx) => tx.insert(healthOrganizerSessions).values({ planId: beta.planId, coverageStart: "2026-12-01", fillLengthDays: 7, snapshotJson: "x", snapshotHash: "x", status: "abandoned", abandonedAt: new Date() })),
      ],
      [
        "a session on your plan that points at another household's occurrence",
        () =>
          inAlpha((tx) =>
            tx.insert(healthOrganizerSessions).values({ planId: alpha.planId, occurrenceId: beta.occurrenceId, coverageStart: "2026-12-01", fillLengthDays: 7, snapshotJson: "x", snapshotHash: "x", status: "abandoned", abandonedAt: new Date() }),
          ),
      ],
      [
        "a fill in another household's session",
        () => inAlpha((tx) => tx.insert(healthOrganizerSessionFills).values({ sessionId: beta.sessionId, medicationId: alpha.medicationId, coveredFrom: "2026-10-05", coveredTo: "2026-10-06", idempotencyKey: `${marker}-x1` })),
      ],
      [
        "a fill in your session for another household's medication",
        () => inAlpha((tx) => tx.insert(healthOrganizerSessionFills).values({ sessionId: alpha.sessionId, medicationId: beta.medicationId, coveredFrom: "2026-10-05", coveredTo: "2026-10-06", idempotencyKey: `${marker}-x2` })),
      ],
    ];
    for (const [label, write] of cases) expect(await sqlState(write()), label).toBe(RLS_VIOLATION);

    // Nothing leaked into Beta.
    const betaRows = await withHouseholdContext(db, beta.householdId, (tx) =>
      tx.select({ id: healthOrganizerSessionFills.id }).from(healthOrganizerSessionFills).where(eq(healthOrganizerSessionFills.sessionId, beta.sessionId)),
    );
    expect(betaRows).toHaveLength(1);
  });

  it("cannot update or delete another tenant's rows", async () => {
    await inAlpha(async (tx) => {
      await tx.update(healthOrganizerPlans).set({ fillLengthDays: 7 }).where(eq(healthOrganizerPlans.id, beta.planId));
      await tx.update(healthOrganizerSessions).set({ snapshotHash: "tampered" }).where(eq(healthOrganizerSessions.id, beta.sessionId));
      await tx.delete(healthOrganizerSessionFills).where(eq(healthOrganizerSessionFills.id, beta.fillId));
      await tx.delete(healthOrganizerCompartments).where(eq(healthOrganizerCompartments.id, beta.compartmentId));
    });
    await withHouseholdContext(db, beta.householdId, async (tx) => {
      const [p] = await tx.select({ n: healthOrganizerPlans.fillLengthDays }).from(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, beta.planId));
      const [s] = await tx.select({ h: healthOrganizerSessions.snapshotHash }).from(healthOrganizerSessions).where(eq(healthOrganizerSessions.id, beta.sessionId));
      const fills = await tx.select({ id: healthOrganizerSessionFills.id }).from(healthOrganizerSessionFills).where(eq(healthOrganizerSessionFills.id, beta.fillId));
      const comps = await tx.select({ id: healthOrganizerCompartments.id }).from(healthOrganizerCompartments).where(eq(healthOrganizerCompartments.id, beta.compartmentId));
      expect(p?.n).toBe(31);
      expect(s?.h).toBe("h1");
      expect(fills).toHaveLength(1);
      expect(comps).toHaveLength(1);
    });
  });

  it("lets the worker scan see every tenant", async () => {
    const rows = await withWorkerScanContext(db, (tx) =>
      tx.select({ id: healthOrganizerPlans.id }).from(healthOrganizerPlans).where(inArray(healthOrganizerPlans.id, [alpha.planId, beta.planId])),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([alpha.planId, beta.planId].sort());
  });

  describe("constraints", () => {
    /** A throwaway member in Alpha so a new plan does not collide with the seeded one. */
    async function freshMember() {
      return inAlpha(async (tx) => {
        const [u] = await tx.insert(users).values({ username: `${marker}-m-${Math.random().toString(36).slice(2, 8)}` }).returning({ id: users.id });
        const [m] = await tx.insert(householdMembers).values({ householdId: alpha.householdId, userId: u!.id }).returning({ id: householdMembers.id });
        extraUsers.push({ userId: u!.id, memberId: m!.id });
        return m!.id;
      });
    }
    const extraUsers: Array<{ userId: string; memberId: string }> = [];
    afterAll(async () => {
      if (!db) return;
      await withWorkerScanContext(db, async (tx) => {
        for (const u of extraUsers) {
          await tx.delete(householdMembers).where(eq(householdMembers.id, u.memberId));
          await tx.delete(users).where(eq(users.id, u.userId));
        }
      });
    });

    describe("plans", () => {
      it("needs a schedule that matches its kind", async () => {
        const bad: Array<[string, Partial<typeof healthOrganizerPlans.$inferInsert>]> = [
          ["every N days without N", { scheduleKind: "every_n_days", everyN: null }],
          ["every N days with N = 0", { scheduleKind: "every_n_days", everyN: 0 }],
          ["every N days with N = 366", { scheduleKind: "every_n_days", everyN: 366 }],
          ["every N days that also names a monthly day", { scheduleKind: "every_n_days", everyN: 5, monthlyDay: 5 }],
          ["monthly without a day", { scheduleKind: "monthly_date", everyN: null, monthlyDay: null }],
          ["monthly on day 0", { scheduleKind: "monthly_date", everyN: null, monthlyDay: 0 }],
          ["monthly on day 32", { scheduleKind: "monthly_date", everyN: null, monthlyDay: 32 }],
          ["monthly that also names an interval", { scheduleKind: "monthly_date", everyN: 5, monthlyDay: 5 }],
          ["an unknown kind", { scheduleKind: "weekly" as never }],
        ];
        for (const [label, over] of bad) {
          const memberId = await freshMember();
          expect(await sqlState(inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, memberId, over)))), label).toBe(CHECK_VIOLATION);
        }
        for (const [label, over] of [
          ["every 1 day", { everyN: 1 }],
          ["every 365 days", { everyN: 365 }],
          ["the 31st of the month", { scheduleKind: "monthly_date" as const, everyN: null, monthlyDay: 31 }],
        ] as const) {
          const memberId = await freshMember();
          expect(await sqlState(inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, memberId, over)))), label).toBeNull();
        }
      });

      it("keeps the fill length within 1 to 93 days and the reminder on a whole minute", async () => {
        for (const fillLengthDays of [0, 94]) {
          const memberId = await freshMember();
          expect(await sqlState(inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, memberId, { fillLengthDays })))), `length ${fillLengthDays}`).toBe(CHECK_VIOLATION);
        }
        const memberId = await freshMember();
        expect(await sqlState(inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, memberId, { reminderTime: "09:00:30" })))), "seconds").toBe(CHECK_VIOLATION);
      });

      it("allows one live plan per person, and archiving frees the place", async () => {
        expect(await sqlState(inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, alphaSecond.memberId))))).toBe(UNIQUE_VIOLATION);
        const memberId = await freshMember();
        const [first] = await inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, memberId)).returning({ id: healthOrganizerPlans.id }));
        await inAlpha((tx) => tx.update(healthOrganizerPlans).set({ archivedAt: new Date() }).where(eq(healthOrganizerPlans.id, first!.id)));
        expect(await sqlState(inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, memberId))))).toBeNull();
      });
    });

    describe("compartments and the time map", () => {
      it("keeps names and positions sane and ordered without repeats", async () => {
        const at = (position: number, name = "Extra") => inAlpha((tx) => tx.insert(healthOrganizerCompartments).values({ planId: alphaSecond.planId, name, position }));
        expect(await sqlState(at(0, "Dupe"))).toBe(UNIQUE_VIOLATION);
        expect(await sqlState(at(16))).toBe(CHECK_VIOLATION);
        expect(await sqlState(at(-1))).toBe(CHECK_VIOLATION);
        expect(await sqlState(at(5, "   "))).toBe(CHECK_VIOLATION);
        expect(await sqlState(at(5, "x".repeat(41)))).toBe(CHECK_VIOLATION);
        expect(await sqlState(at(5, "Bedtime"))).toBeNull();
      });

      it("maps a time only to a compartment of its own plan", async () => {
        expect(
          await sqlState(inAlpha((tx) => tx.insert(healthOrganizerTimeMap).values({ planId: alphaSecond.planId, doseTime: "20:00", compartmentId: alpha.compartmentId }))),
        ).toBe(FOREIGN_KEY_VIOLATION);
        expect(
          await sqlState(inAlpha((tx) => tx.insert(healthOrganizerTimeMap).values({ planId: alphaSecond.planId, doseTime: "20:00", compartmentId: alphaSecond.compartmentId }))),
        ).toBeNull();
      });

      it("maps each time once, on a whole minute", async () => {
        expect(
          await sqlState(inAlpha((tx) => tx.insert(healthOrganizerTimeMap).values({ planId: alphaSecond.planId, doseTime: "20:00", compartmentId: alphaSecond.compartmentId }))),
        ).toBe(UNIQUE_VIOLATION);
        expect(
          await sqlState(inAlpha((tx) => tx.insert(healthOrganizerTimeMap).values({ planId: alphaSecond.planId, doseTime: "21:00:30", compartmentId: alphaSecond.compartmentId }))),
        ).toBe(CHECK_VIOLATION);
      });

      it("drops a compartment's mappings with it", async () => {
        const [c] = await inAlpha((tx) =>
          tx.insert(healthOrganizerCompartments).values({ planId: alphaSecond.planId, name: "Temp", position: 9 }).returning({ id: healthOrganizerCompartments.id }),
        );
        await inAlpha((tx) => tx.insert(healthOrganizerTimeMap).values({ planId: alphaSecond.planId, doseTime: "22:00", compartmentId: c!.id }));
        await inAlpha((tx) => tx.delete(healthOrganizerCompartments).where(eq(healthOrganizerCompartments.id, c!.id)));
        const left = await inAlpha((tx) =>
          tx.select().from(healthOrganizerTimeMap).where(and(eq(healthOrganizerTimeMap.planId, alphaSecond.planId), eq(healthOrganizerTimeMap.doseTime, "22:00:00"))),
        );
        expect(left).toHaveLength(0);
      });
    });

    describe("dose quantities", () => {
      it("accepts quarter-step amounts from one quarter to one hundred pills and one per time", async () => {
        const put = (doseTime: string, quantityQuarters: number) =>
          inAlpha((tx) => tx.insert(healthMedicationDoseQuantities).values({ medicationId: alpha.medicationId, doseTime, quantityQuarters }));
        expect(await sqlState(put("09:00", 0))).toBe(CHECK_VIOLATION);
        expect(await sqlState(put("09:00", 401))).toBe(CHECK_VIOLATION);
        expect(await sqlState(put("09:00:30", 4))).toBe(CHECK_VIOLATION);
        expect(await sqlState(put("09:00", 1))).toBeNull();
        expect(await sqlState(put("10:00", 400))).toBeNull();
        expect(await sqlState(put("09:00", 4))).toBe(UNIQUE_VIOLATION);
      });
    });

    describe("occurrences", () => {
      const occ = (over: Partial<typeof healthOrganizerOccurrences.$inferInsert>) =>
        inAlpha((tx) => tx.insert(healthOrganizerOccurrences).values({ planId: alpha.planId, occurrenceDate: "2026-11-05", ...over }));

      it("knows its outcomes, and a reschedule always has a different date", async () => {
        expect(await sqlState(occ({ outcome: "forgotten" as never }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(occ({ outcome: "rescheduled" }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(occ({ outcome: "skipped", rescheduledTo: "2026-11-09" }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(occ({ outcome: "rescheduled", rescheduledTo: "2026-11-05" }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(occ({ outcome: "rescheduled", rescheduledTo: "2026-11-02" }))).toBeNull();
      });

      it("has one occurrence per plan per date", async () => {
        expect(await sqlState(occ({ occurrenceDate: "2026-10-05" }))).toBe(UNIQUE_VIOLATION);
      });

      it("keeps history only between known outcomes", async () => {
        expect(
          await sqlState(inAlpha((tx) => tx.insert(healthOrganizerOccurrenceEvents).values({ occurrenceId: alpha.occurrenceId, fromOutcome: "pending", toOutcome: "nope" as never }))),
        ).toBe(CHECK_VIOLATION);
      });
    });

    describe("sessions and fills", () => {
      const session = (planId: string, over: Partial<typeof healthOrganizerSessions.$inferInsert> = {}) =>
        inAlpha((tx) => tx.insert(healthOrganizerSessions).values({ planId, coverageStart: "2026-11-05", fillLengthDays: 31, snapshotJson: "enc:{}", snapshotHash: "h2", ...over }));

      it("has at most one open session per plan, and a new one once it is closed", async () => {
        // Alpha already has an open session from the seed.
        expect(await sqlState(session(alpha.planId))).toBe(UNIQUE_VIOLATION);
        // Another plan is unaffected, and a finished session does not count as open.
        expect(await sqlState(session(alphaSecond.planId, { status: "finished", finishedAt: new Date() }))).toBeNull();
        expect(await sqlState(session(alphaSecond.planId))).toBeNull();
        expect(await sqlState(session(alphaSecond.planId))).toBe(UNIQUE_VIOLATION);
      });

      it("keeps status, length and timestamps consistent", async () => {
        const memberId = await freshMember();
        const [p] = await inAlpha((tx) => tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, memberId)).returning({ id: healthOrganizerPlans.id }));
        expect(await sqlState(session(p!.id, { status: "paused" as never }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(session(p!.id, { fillLengthDays: 0 }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(session(p!.id, { fillLengthDays: 94 }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(session(p!.id, { status: "finished" }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(session(p!.id, { status: "abandoned" }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(session(p!.id, { status: "open", finishedAt: new Date() }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(session(p!.id, { status: "abandoned", abandonedAt: new Date() }))).toBeNull();
      });

      const fill = (over: Partial<typeof healthOrganizerSessionFills.$inferInsert>) =>
        inAlpha((tx) =>
          tx.insert(healthOrganizerSessionFills).values({ sessionId: alpha.sessionId, medicationId: alpha.medicationId, coveredFrom: "2026-10-05", coveredTo: "2026-10-10", idempotencyKey: `${marker}-${Math.random()}`, ...over }),
        );

      it("refuses reversed ranges and negative outside days", async () => {
        expect(await sqlState(fill({ coveredFrom: "2026-10-10", coveredTo: "2026-10-09" }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(fill({ outsideDays: -1 }))).toBe(CHECK_VIOLATION);
        expect(await sqlState(fill({ coveredFrom: "2026-10-10", coveredTo: "2026-10-10", outsideDays: 0 }))).toBeNull();
      });

      it("returns the first result for a repeated submission instead of a second row", async () => {
        const key = `${marker}-same-key`;
        expect(await sqlState(fill({ idempotencyKey: key }))).toBeNull();
        expect(await sqlState(fill({ idempotencyKey: key }))).toBe(UNIQUE_VIOLATION);
      });
    });

    describe("cascades", () => {
      it("clears references instead of deleting history, and removes children with their parent", async () => {
        const memberId = await freshMember();
        const ids = await inAlpha(async (tx) => {
          const [p] = await tx.insert(healthOrganizerPlans).values(plan(alpha.householdId, memberId)).returning({ id: healthOrganizerPlans.id });
          const [o] = await tx.insert(healthOrganizerOccurrences).values({ planId: p!.id, occurrenceDate: "2026-12-05" }).returning({ id: healthOrganizerOccurrences.id });
          const [s] = await tx
            .insert(healthOrganizerSessions)
            .values({ planId: p!.id, occurrenceId: o!.id, coverageStart: "2026-12-05", fillLengthDays: 31, snapshotJson: "x", snapshotHash: "x" })
            .returning({ id: healthOrganizerSessions.id });
          const [m] = await tx
            .insert(healthMedications)
            .values({ householdId: alpha.householdId, memberId, name: `${marker}-cascade-med` })
            .returning({ id: healthMedications.id });
          await tx.insert(healthMedicationSupplyRevisions).values({
            medicationId: m!.id,
            revision: 1,
            source: "fill",
            runsOutOn: "2027-01-05",
            estimatedOn: "2026-12-05",
            outsideDays: 0,
            organizerDaysCounted: 31,
            sessionId: s!.id,
          });
          await tx.insert(healthOrganizerSessionFills).values({ sessionId: s!.id, medicationId: m!.id, coveredFrom: "2026-12-05", coveredTo: "2027-01-04", idempotencyKey: `${marker}-casc` });
          return { planId: p!.id, occurrenceId: o!.id, sessionId: s!.id, medicationId: m!.id };
        });

        // Removing the appointment leaves the session, which just forgets which appointment it was for.
        await inAlpha((tx) => tx.delete(healthOrganizerOccurrences).where(eq(healthOrganizerOccurrences.id, ids.occurrenceId)));
        const [s1] = await inAlpha((tx) => tx.select({ o: healthOrganizerSessions.occurrenceId }).from(healthOrganizerSessions).where(eq(healthOrganizerSessions.id, ids.sessionId)));
        expect(s1?.o).toBeNull();

        // Removing the plan removes its sessions and their fills, but the supply estimate history stays.
        await inAlpha((tx) => tx.delete(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, ids.planId)));
        expect(await inAlpha((tx) => tx.select().from(healthOrganizerSessions).where(eq(healthOrganizerSessions.id, ids.sessionId)))).toHaveLength(0);
        expect(await inAlpha((tx) => tx.select().from(healthOrganizerSessionFills).where(eq(healthOrganizerSessionFills.sessionId, ids.sessionId)))).toHaveLength(0);
        const [rev] = await inAlpha((tx) => tx.select({ session: healthMedicationSupplyRevisions.sessionId }).from(healthMedicationSupplyRevisions).where(eq(healthMedicationSupplyRevisions.medicationId, ids.medicationId)));
        expect(rev).toBeDefined();
        expect(rev?.session).toBeNull();

        // Removing the medication removes its quantities and revisions.
        await inAlpha((tx) => tx.insert(healthMedicationDoseQuantities).values({ medicationId: ids.medicationId, doseTime: "07:00", quantityQuarters: 4 }));
        await inAlpha((tx) => tx.delete(healthMedications).where(eq(healthMedications.id, ids.medicationId)));
        expect(await inAlpha((tx) => tx.select().from(healthMedicationDoseQuantities).where(eq(healthMedicationDoseQuantities.medicationId, ids.medicationId)))).toHaveLength(0);
        expect(await inAlpha((tx) => tx.select().from(healthMedicationSupplyRevisions).where(eq(healthMedicationSupplyRevisions.medicationId, ids.medicationId)))).toHaveLength(0);
      });
    });
  });
});
