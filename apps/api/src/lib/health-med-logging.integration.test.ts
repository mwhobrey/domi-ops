import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthMedicationLogs,
  healthMedications,
  households,
  householdMembers,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import { recordDose } from "./health-med-logging.js";

/**
 * WHO-280: prove the one-writer / one-conflict-rule contract holds against a real Postgres
 * with the `health_medication_logs_instant_unique` index in place. Runs in `test:hosted`
 * (needs migrations applied); skipped otherwise.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

// recordDose only touches crypto when given `notes` or `alsoCreateEvent`; these tests pass
// neither, so an empty Env is fine.
const env = {} as Env;
const instant = new Date("2026-02-01T08:00:00.000Z");

maybeDescribe("recordDose conflict rules (integration)", () => {
  let db: Database;
  let householdId: string;
  let userId: string;
  let med: typeof healthMedications.$inferSelect;

  const base = () => ({
    med,
    householdId,
    loggedByUserId: userId,
    loggedAt: new Date(),
    scheduledAt: instant,
  });

  async function logRows(scheduledAt: Date | null) {
    return withHouseholdContext(db, householdId, (tx) =>
      tx
        .select()
        .from(healthMedicationLogs)
        .where(
          scheduledAt
            ? and(
                eq(healthMedicationLogs.medicationId, med.id),
                eq(healthMedicationLogs.scheduledAt, scheduledAt),
              )
            : eq(healthMedicationLogs.medicationId, med.id),
        ),
    );
  }

  async function clearLogs() {
    await withHouseholdContext(db, householdId, (tx) =>
      tx.delete(healthMedicationLogs).where(eq(healthMedicationLogs.medicationId, med.id)),
    );
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    let memberId = "";
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "recordDose-it", timezone: "UTC" })
        .returning({ id: households.id });
      householdId = hh.id;
      const [u] = await tx
        .insert(users)
        .values({ displayName: "recordDose-it tester", emailVerified: true })
        .returning({ id: users.id });
      userId = u.id;
      const [m] = await tx
        .insert(householdMembers)
        .values({ householdId, userId, role: "owner", name: "Tester" })
        .returning({ id: householdMembers.id });
      memberId = m.id;
    });
    await withHouseholdContext(db, householdId, async (tx) => {
      const [row] = await tx
        .insert(healthMedications)
        .values({ householdId, memberId, name: "TestMed", scheduleKind: "scheduled" })
        .returning();
      med = row;
    });
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      if (userId) await tx.delete(users).where(eq(users.id, userId));
    });
    await closeDb(db);
  });

  it("bulk never overrides a manual skip", async () => {
    await clearLogs();
    await withHouseholdContext(db, householdId, (tx) =>
      recordDose(tx, env, { ...base(), status: "skipped", source: "single" }),
    );
    const res = await withHouseholdContext(db, householdId, (tx) =>
      recordDose(tx, env, { ...base(), status: "taken", source: "bulk" }),
    );
    expect(res.outcome).toBe("unchanged");
    const rows = await logRows(instant);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("skipped");
  });

  it("a single action overrides a prior log for the same instant", async () => {
    await clearLogs();
    for (const status of ["skipped", "taken"] as const) {
      await withHouseholdContext(db, householdId, (tx) =>
        recordDose(tx, env, { ...base(), status, source: "single" }),
      );
    }
    const rows = await logRows(instant);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("taken");
  });

  it("repeated bulk logging is idempotent", async () => {
    await clearLogs();
    for (let i = 0; i < 3; i++) {
      await withHouseholdContext(db, householdId, (tx) =>
        recordDose(tx, env, { ...base(), status: "taken", source: "bulk" }),
      );
    }
    expect(await logRows(instant)).toHaveLength(1);
  });

  it("PRN doses (null scheduledAt) are not deduped", async () => {
    await clearLogs();
    for (let i = 0; i < 2; i++) {
      await withHouseholdContext(db, householdId, (tx) =>
        recordDose(tx, env, { ...base(), scheduledAt: null, status: "taken", source: "single" }),
      );
    }
    expect(await logRows(null)).toHaveLength(2);
  });
});
