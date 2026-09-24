import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthEventShares,
  healthEvents,
  healthMedications,
  healthMedicationShares,
  healthMemberAcl,
  households,
  householdMembers,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import {
  enrichHealthEvents,
  enrichHealthMedications,
  loadExerciseDetailsForEvents,
  loadPainLogsForEvents,
  replaceExerciseDetails,
  replacePainLogs,
} from "./health-serialize.js";

/**
 * WHO-293 (CodeRabbit-requested regression coverage): a non-creator with legitimate write
 * access to a subject's health events/medications — via segment ACL, not household-admin
 * override — must see the record's real shares, not the blank slate that used to silently
 * overwrite them on save. Runs in `test:hosted` (needs migrations applied); skipped otherwise.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = {} as Env;

maybeDescribe("enrichHealthEvents / enrichHealthMedications sharing (integration)", () => {
  let db: Database;
  let householdId: string;
  let subjectMemberId: string;
  let subjectUserId: string;
  let granteeMemberId: string;
  let granteeUserId: string;
  let sharedWithMemberId: string;
  let sharedWithUserId: string;

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "health-serialize-it", timezone: "UTC" })
        .returning({ id: households.id });
      householdId = hh.id;

      const [subjectUser] = await tx
        .insert(users)
        .values({
          email: `health-serialize-subject-${randomUUID()}@test.local`,
          displayName: "Subject",
          emailVerified: true,
        })
        .returning({ id: users.id });
      subjectUserId = subjectUser.id;
      const [subjectMember] = await tx
        .insert(householdMembers)
        .values({ householdId, userId: subjectUserId, role: "owner", name: "Subject" })
        .returning({ id: householdMembers.id });
      subjectMemberId = subjectMember.id;

      const [granteeUser] = await tx
        .insert(users)
        .values({
          email: `health-serialize-grantee-${randomUUID()}@test.local`,
          displayName: "Grantee",
          emailVerified: true,
        })
        .returning({ id: users.id });
      granteeUserId = granteeUser.id;
      // Deliberately "member", not admin/owner — isolates the segment-ACL write path from the
      // canManageMemberHealth admin-override path; both feed the same canEdit computation, but
      // this is the path CodeRabbit's comment specifically asked to cover.
      const [granteeMember] = await tx
        .insert(householdMembers)
        .values({ householdId, userId: granteeUserId, role: "member", name: "Grantee" })
        .returning({ id: householdMembers.id });
      granteeMemberId = granteeMember.id;

      const [sharedWithUser] = await tx
        .insert(users)
        .values({
          email: `health-serialize-sharedwith-${randomUUID()}@test.local`,
          displayName: "Shared-with",
          emailVerified: true,
        })
        .returning({ id: users.id });
      sharedWithUserId = sharedWithUser.id;
      const [sharedWithMember] = await tx
        .insert(householdMembers)
        .values({ householdId, userId: sharedWithUserId, role: "member", name: "Shared-with" })
        .returning({ id: householdMembers.id });
      sharedWithMemberId = sharedWithMember.id;
    });

    await withHouseholdContext(db, householdId, (tx) =>
      tx.insert(healthMemberAcl).values({
        householdId,
        subjectMemberId,
        granteeMemberId,
        eventsAccess: "write",
        medicationsAccess: "write",
        dosesAccess: "none",
        reportsAccess: "none",
      }),
    );
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      if (subjectUserId) await tx.delete(users).where(eq(users.id, subjectUserId));
      if (granteeUserId) await tx.delete(users).where(eq(users.id, granteeUserId));
      if (sharedWithUserId) await tx.delete(users).where(eq(users.id, sharedWithUserId));
    });
    await closeDb(db);
  });

  const granteeAuth = () => ({
    userId: granteeUserId,
    memberId: granteeMemberId,
    householdId,
    role: "member",
  });

  it("a non-creator with write ACL sees the real shares on a private event, not undefined", async () => {
    const [event] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthEvents)
        .values({
          householdId,
          memberId: subjectMemberId,
          type: "symptom",
          title: "Test symptom",
          visibility: "private",
          createdByUserId: subjectUserId,
        })
        .returning(),
    );
    await withHouseholdContext(db, householdId, (tx) =>
      tx.insert(healthEventShares).values({ eventId: event.id, memberId: sharedWithMemberId }),
    );

    const [enriched] = await withHouseholdContext(db, householdId, (tx) =>
      enrichHealthEvents(tx, env, granteeAuth(), [event], "UTC"),
    );

    expect(enriched.canEdit).toBe(true);
    expect(enriched.isOwnedByMe).toBe(false);
    expect(enriched.sharedMemberIds).toEqual([sharedWithMemberId]);
  });

  it("a non-creator with write ACL sees the real shares on a private medication, not undefined", async () => {
    const [medication] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthMedications)
        .values({
          householdId,
          memberId: subjectMemberId,
          name: "Test med",
          scheduleKind: "prn",
          visibility: "private",
          createdByUserId: subjectUserId,
        })
        .returning(),
    );
    await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthMedicationShares)
        .values({ medicationId: medication.id, memberId: sharedWithMemberId }),
    );

    const [enriched] = await withHouseholdContext(db, householdId, (tx) =>
      enrichHealthMedications(tx, env, granteeAuth(), [medication]),
    );

    expect(enriched.canEdit).toBe(true);
    expect(enriched.isOwnedByMe).toBe(false);
    expect(enriched.sharedMemberIds).toEqual([sharedWithMemberId]);
  });

  // WHO-339: household visibility is read access, not write. A member with no ACL on the
  // subject can see a household event/med but must not get canEdit (the PATCH guard agrees).
  it("household visibility alone doesn't grant canEdit", async () => {
    const noAclAuth = { userId: sharedWithUserId, memberId: sharedWithMemberId, householdId, role: "member" };
    const [event] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthEvents)
        .values({
          householdId,
          memberId: subjectMemberId,
          type: "symptom",
          title: "Household symptom",
          visibility: "household",
          createdByUserId: subjectUserId,
        })
        .returning(),
    );
    const [medication] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthMedications)
        .values({
          householdId,
          memberId: subjectMemberId,
          name: "Household med",
          scheduleKind: "prn",
          visibility: "household",
          createdByUserId: subjectUserId,
        })
        .returning(),
    );

    const [enrichedEvent] = await withHouseholdContext(db, householdId, (tx) =>
      enrichHealthEvents(tx, env, noAclAuth, [event], "UTC"),
    );
    const [enrichedMed] = await withHouseholdContext(db, householdId, (tx) =>
      enrichHealthMedications(tx, env, noAclAuth, [medication]),
    );

    expect(enrichedEvent.canEdit).toBe(false);
    expect(enrichedMed.canEdit).toBe(false);
  });
});

/**
 * WHO-299: exercise/pain detail rows round-trip through real encryption (quantitative fields
 * are encrypted text, same convention as vitals `value` — see packages/db/src/schema/health.ts).
 */
const encryptedEnv = { ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" } as Env;

maybeDescribe("exercise/pain detail persistence (integration)", () => {
  let db: Database;
  let householdId: string;
  let memberId: string;
  let userId: string;

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "health-exercise-pain-it", timezone: "UTC" })
        .returning({ id: households.id });
      householdId = hh.id;
      const [user] = await tx
        .insert(users)
        .values({
          email: `health-exercise-pain-${randomUUID()}@test.local`,
          displayName: "Tester",
          emailVerified: true,
        })
        .returning({ id: users.id });
      userId = user.id;
      const [member] = await tx
        .insert(householdMembers)
        .values({ householdId, userId, role: "owner", name: "Tester" })
        .returning({ id: householdMembers.id });
      memberId = member.id;
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

  it("round-trips encrypted exercise detail fields", async () => {
    const [event] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthEvents)
        .values({
          householdId,
          memberId,
          type: "exercise",
          title: "Morning workout",
          visibility: "private",
          createdByUserId: userId,
        })
        .returning(),
    );

    await withHouseholdContext(db, householdId, (tx) =>
      replaceExerciseDetails(tx, encryptedEnv, event.id, [
        {
          activity: "Running",
          durationMinutes: 32,
          intensity: "vigorous",
          distance: 4.2,
          distanceUnit: "mi",
          sets: null,
          reps: null,
          caloriesEstimated: 310,
        },
      ]),
    );

    const map = await withHouseholdContext(db, householdId, (tx) =>
      loadExerciseDetailsForEvents(tx, encryptedEnv, [event.id]),
    );
    const details = map.get(event.id);
    expect(details).toHaveLength(1);
    expect(details![0]).toMatchObject({
      activity: "Running",
      durationMinutes: 32,
      intensity: "vigorous",
      distance: 4.2,
      distanceUnit: "mi",
      sets: null,
      reps: null,
      caloriesEstimated: 310,
      externalSource: "manual",
    });
  });

  it("round-trips encrypted pain severity and quality tags across multiple regions", async () => {
    const [event] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthEvents)
        .values({
          householdId,
          memberId,
          type: "pain",
          title: "Pain check-in",
          visibility: "private",
          createdByUserId: userId,
        })
        .returning(),
    );

    await withHouseholdContext(db, householdId, (tx) =>
      replacePainLogs(tx, encryptedEnv, event.id, [
        { bodyRegion: "front_head", severity: 6, qualityTags: ["throbbing", "sharp"] },
        { bodyRegion: "neck_front", severity: 4, qualityTags: null },
      ]),
    );

    const map = await withHouseholdContext(db, householdId, (tx) =>
      loadPainLogsForEvents(tx, encryptedEnv, [event.id]),
    );
    const logs = map.get(event.id)!.sort((a, b) => b.severity - a.severity);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      bodyRegion: "front_head",
      severity: 6,
      qualityTags: ["throbbing", "sharp"],
    });
    expect(logs[1]).toMatchObject({
      bodyRegion: "neck_front",
      severity: 4,
      qualityTags: null,
    });
  });

  it("replace fully overwrites prior details, matching the vitals replace-not-append pattern", async () => {
    const [event] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthEvents)
        .values({
          householdId,
          memberId,
          type: "exercise",
          title: "Evening workout",
          visibility: "private",
          createdByUserId: userId,
        })
        .returning(),
    );

    await withHouseholdContext(db, householdId, (tx) =>
      replaceExerciseDetails(tx, encryptedEnv, event.id, [
        { activity: "Cycling" },
        { activity: "Yoga" },
      ]),
    );
    await withHouseholdContext(db, householdId, (tx) =>
      replaceExerciseDetails(tx, encryptedEnv, event.id, [{ activity: "Swimming" }]),
    );

    const map = await withHouseholdContext(db, householdId, (tx) =>
      loadExerciseDetailsForEvents(tx, encryptedEnv, [event.id]),
    );
    const details = map.get(event.id);
    expect(details).toHaveLength(1);
    expect(details![0].activity).toBe("Swimming");
  });
});
