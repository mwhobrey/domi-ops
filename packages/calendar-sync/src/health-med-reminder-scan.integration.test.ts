import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, like } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthMedReminderSent,
  healthMedicationLogs,
  healthMedications,
  healthMemberAcl,
  householdMembers,
  households,
  userNotifications,
  users,
  withHouseholdContext,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import { scanHealthMedReminders } from "./health-med-reminder-scan.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

// No VAPID keys: delivery only writes the inbox row, so nothing leaves the process.
const env = { ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" } as Env;

/**
 * Characterization of the medication reminder scan (it had no coverage of its main loop). Written
 * while moving helpers out of it (WHO-386) and run against the code before and after the move, so
 * the move provably changed nothing. The scan uses the real clock, so the dose is scheduled a few
 * minutes ahead of "now" in the household's time zone (UTC).
 */
maybeDescribe("scanHealthMedReminders (integration)", () => {
  let db: Database;
  let householdId: string;
  const userIds: Record<string, string> = {};
  const memberIds: Record<string, string> = {};

  /** Reminders recorded for this test's household. */
  const remindersRecorded = () =>
    withWorkerScanContext(db, async (tx) => {
      const [row] = await tx
        .select({ n: count() })
        .from(healthMedReminderSent)
        .innerJoin(healthMedications, eq(healthMedications.id, healthMedReminderSent.medicationId))
        .where(eq(healthMedications.householdId, householdId));
      return row!.n;
    });

  // Runs the way the worker does: the per-household job, inside that household's own context. Report
  // what it recorded for this household only, since other suites share the database.
  const runScan = async () => {
    const before = await remindersRecorded();
    await withHouseholdContext(db, householdId, (tx) => scanHealthMedReminders(tx, env, { householdId }));
    return (await remindersRecorded()) - before;
  };

  const hhmmIn = (minutes: number) => {
    const t = new Date(Date.now() + minutes * 60_000);
    return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
  };

  async function makeMed(minutesAhead: number) {
    const [row] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthMedications)
        .values({
          householdId,
          memberId: memberIds.ally!,
          name: "ScanTestMed",
          scheduleKind: "scheduled",
          scheduleJson: JSON.stringify({ times: [hhmmIn(minutesAhead)] }),
          reminderOffsetsJson: "[0]",
        })
        .returning(),
    );
    return row!;
  }

  const inbox = (userKey: string, medId: string) =>
    withWorkerScanContext(db, (tx) =>
      tx
        .select()
        .from(userNotifications)
        .where(and(eq(userNotifications.userId, userIds[userKey]!), like(userNotifications.tag, `health-med-${medId}-%`))),
    );

  async function seedUser(key: string, name: string, role: "owner" | "member", push = true) {
    await withSystemContext(db, async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: `medscan-${key}-${randomUUID()}@test.local`,
          displayName: name,
          emailVerified: true,
          pushHealthRemindersEnabled: push,
        })
        .returning({ id: users.id });
      userIds[key] = u.id;
      const [m] = await tx
        .insert(householdMembers)
        .values({ householdId, userId: u.id, role, name })
        .returning({ id: householdMembers.id });
      memberIds[key] = m.id;
    });
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "medscan-it", timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdId = hh.id;
    });
    await seedUser("ally", "Ally", "member");
    await seedUser("mom", "Mom", "owner");
    await seedUser("reader", "Reader", "member");
    await withHouseholdContext(db, householdId, (tx) =>
      tx.insert(healthMemberAcl).values([
        { householdId, subjectMemberId: memberIds.ally!, granteeMemberId: memberIds.mom!, dosesAccess: "write" },
        { householdId, subjectMemberId: memberIds.ally!, granteeMemberId: memberIds.reader!, dosesAccess: "read" },
      ]),
    );
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      const ids = Object.values(userIds);
      if (ids.length) await tx.delete(users).where(inArray(users.id, ids));
    });
    await closeDb(db);
  });

  it("reminds the person and a caregiver with doses write, with the caregiver copy naming whose dose it is", async () => {
    const med = await makeMed(3);
    await runScan();
    const ally = await inbox("ally", med.id);
    const mom = await inbox("mom", med.id);
    expect(ally).toHaveLength(1);
    expect(mom).toHaveLength(1);
    expect(ally[0]!.title).toMatch(/^Medication reminder • /);
    expect(ally[0]!.body).toContain("ScanTestMed");
    expect(ally[0]!.body).not.toContain("Ally —");
    expect(mom[0]!.body.startsWith("Ally — ")).toBe(true);
    expect(ally[0]!.url).toContain(`medication=${med.id}`);
    // A grantee who can only read doses is not reminded.
    expect(await inbox("reader", med.id)).toHaveLength(0);
  });

  it("sends each reminder once", async () => {
    const med = await makeMed(3);
    await runScan();
    const second = await runScan();
    expect(second).toBe(0);
    expect(await inbox("ally", med.id)).toHaveLength(1);
    const sent = await withWorkerScanContext(db, (tx) =>
      tx.select().from(healthMedReminderSent).where(eq(healthMedReminderSent.medicationId, med.id)),
    );
    expect(sent.length).toBeGreaterThanOrEqual(2); // one per recipient (inbox-only targets)
  });

  it("does not remind for a dose that is already logged", async () => {
    const med = await makeMed(3);
    const [h, m] = hhmmIn(3).split(":").map(Number);
    const slot = new Date();
    slot.setUTCHours(h!, m!, 0, 0);
    // A dose slot crossing midnight is rare enough in a test run to ignore; keep it on today.
    await withHouseholdContext(db, householdId, (tx) =>
      tx.insert(healthMedicationLogs).values({ medicationId: med.id, scheduledAt: slot, status: "taken" }),
    );
    await runScan();
    expect(await inbox("ally", med.id)).toHaveLength(0);
  });

  it("skips a paused medication and one that is not due yet", async () => {
    const paused = await makeMed(3);
    await withHouseholdContext(db, householdId, (tx) =>
      tx.update(healthMedications).set({ enabled: false }).where(eq(healthMedications.id, paused.id)),
    );
    const later = await makeMed(90);
    await runScan();
    expect(await inbox("ally", paused.id)).toHaveLength(0);
    expect(await inbox("ally", later.id)).toHaveLength(0);
  });
});
