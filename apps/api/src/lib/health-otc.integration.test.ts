import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthMedicationLogs,
  healthMedications,
  households,
  householdMembers,
  isAsNeededMedScheduleKind,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import { normalizeMedSchedule } from "./health-serialize.js";
import { recordDose } from "./health-med-logging.js";

/**
 * WHO-319: OTC schedule kind behaves like PRN — null scheduled_at logs, no scheduled slots.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = {} as Env;

maybeDescribe("OTC medications (WHO-319 integration)", () => {
  let db: Database;
  let householdId: string;
  let userId: string;
  let memberId: string;
  let otcMed: typeof healthMedications.$inferSelect;

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "health-otc-it", timezone: "UTC" })
        .returning({ id: households.id });
      householdId = hh.id;
      const [u] = await tx
        .insert(users)
        .values({
          email: `health-otc-it-${randomUUID()}@test.local`,
          displayName: "OTC tester",
          emailVerified: true,
        })
        .returning({ id: users.id });
      userId = u.id;
      const [m] = await tx
        .insert(householdMembers)
        .values({ householdId, userId, role: "owner", name: "Tester" })
        .returning({ id: householdMembers.id });
      memberId = m.id;
    });

    const scheduleMeta = normalizeMedSchedule({ scheduleKind: "otc" });
    expect(isAsNeededMedScheduleKind(scheduleMeta.scheduleKind)).toBe(true);

    await withHouseholdContext(db, householdId, async (tx) => {
      const [row] = await tx
        .insert(healthMedications)
        .values({
          householdId,
          memberId,
          name: "Ibuprofen",
          scheduleKind: scheduleMeta.scheduleKind,
          scheduleJson: scheduleMeta.scheduleJson,
        })
        .returning();
      otcMed = row;
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

  it("logs doses with scheduled_at null (same as PRN)", async () => {
    await withHouseholdContext(db, householdId, (tx) =>
      recordDose(tx, env, {
        med: otcMed,
        householdId,
        loggedByUserId: userId,
        loggedAt: new Date(),
        scheduledAt: null,
        status: "taken",
        source: "single",
      }),
    );
    const rows = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .select()
        .from(healthMedicationLogs)
        .where(eq(healthMedicationLogs.medicationId, otcMed.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledAt).toBeNull();
  });
});
