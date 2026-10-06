import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthMedicationPauses,
  healthMedicationShares,
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
  healthMemberAcl,
  healthSupplySettings,
  healthOrganizerOccurrences,
  healthOrganizerPlanCaregivers,
  healthOrganizerPlans,
  healthOrganizerSessions,
  healthSupplyFillReminderSent,
  healthSupplyRefillReminderSent,
  householdMembers,
  households,
  pushSubscriptions,
  userNotifications,
  users,
  withHouseholdContext,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import { scanHealthSupplyReminders } from "./health-supply-reminder-scan.js";
import { deliverWebPush } from "./push-delivery.js";

// No real push: a call to deliverWebPush is the "a push was sent" signal, and web-push itself is stubbed.
vi.mock("./push-delivery.js", () => ({ deliverWebPush: vi.fn(async () => undefined) }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn() } }));

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = {
  ENCRYPTION_KEY: "test-health-encryption-key-32chars!!",
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:test@example.com",
} as Env;

/**
 * WHO-432 / WHO-433: fill and refill reminders against a real Postgres with an injected clock. The household is on
 * Chicago time (CDT, UTC-5 until Nov 1): the plan's 09:00 on Oct 6 is 14:00Z. The plan fills every 30 days from Oct 6.
 */
maybeDescribe("scanHealthSupplyReminders (integration)", () => {
  let db: Database;
  let householdId = "";
  let otherHouseholdId = "";
  const userIds: Record<string, string> = {};
  const memberIds: Record<string, string> = {};
  let otherUserId = "";
  let otherMemberId = "";
  const cleanupUsers: string[] = [];

  const at = (iso: string) => new Date(iso);
  const scan = (iso: string, id = householdId) => withHouseholdContext(db, id, (tx) => scanHealthSupplyReminders(tx, env, { now: at(iso), householdId: id }));

  async function seedPerson(key: string, name: string, role: "owner" | "admin" | "member", opts: { push?: boolean; household?: string } = {}) {
    const hh = opts.household ?? householdId;
    return withSystemContext(db, async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ email: `supplyscan-${key}-${randomUUID()}@test.local`, displayName: name, emailVerified: true, pushHealthRemindersEnabled: opts.push ?? true })
        .returning({ id: users.id });
      cleanupUsers.push(u!.id);
      const [m] = await tx.insert(householdMembers).values({ householdId: hh, userId: u!.id, role, name }).returning({ id: householdMembers.id });
      return { userId: u!.id, memberId: m!.id };
    });
  }

  async function makePlan(over: Partial<typeof healthOrganizerPlans.$inferInsert> = {}, caregivers: string[] = ["ally"]) {
    const [plan] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthOrganizerPlans)
        .values({ householdId, memberId: memberIds.ally!, scheduleKind: "every_n_days", everyN: 30, anchorDate: "2026-10-06", reminderTime: "09:00", ...over })
        .returning(),
    );
    if (caregivers.length > 0) {
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthOrganizerPlanCaregivers).values(caregivers.map((k) => ({ planId: plan!.id, memberId: memberIds[k]! }))),
      );
    }
    return plan!;
  }

  async function makeMed(over: Partial<typeof healthMedications.$inferInsert> = {}, supply?: Partial<typeof healthMedicationSupply.$inferInsert> & { revisedAt?: Date }) {
    return withHouseholdContext(db, householdId, async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({ householdId, memberId: memberIds.ally!, name: "Metformin", scheduleKind: "scheduled", scheduleJson: JSON.stringify({ times: ["08:00"] }), visibility: "household", ...over })
        .returning();
      if (supply) {
        const { revisedAt, ...row } = supply;
        const runsOutOn = row.runsOutOn ?? "2026-10-26";
        const revision = row.revision ?? 1;
        await tx.insert(healthMedicationSupply).values({ medicationId: m!.id, runsOutOn, estimatedOn: "2026-10-01", outsideDays: 0, organizerDaysCounted: 0, revision, leadDays: 7, ...row });
        await tx.insert(healthMedicationSupplyRevisions).values({
          medicationId: m!.id,
          revision,
          source: "manual",
          runsOutOn,
          estimatedOn: "2026-10-01",
          outsideDays: 0,
          organizerDaysCounted: 0,
          ...(revisedAt ? { createdAt: revisedAt } : {}),
        });
      }
      return m!;
    });
  }

  const inbox = (userKey: string, tagLike: string) =>
    withWorkerScanContext(db, (tx) =>
      tx.select().from(userNotifications).where(and(eq(userNotifications.userId, userIds[userKey]!), like(userNotifications.tag, tagLike))),
    );
  const whoWasTold = async (tagLike: string, keys = ["ally", "mom", "dad", "sitter", "nopush", "stranger"]) => {
    const told: string[] = [];
    for (const key of keys) if ((await inbox(key, tagLike)).length > 0) told.push(key);
    return told;
  };
  const pushCalls = () => vi.mocked(deliverWebPush).mock.calls.length;

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "supplyscan-it", timezone: "America/Chicago", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdId = hh!.id;
      const [other] = await tx
        .insert(households)
        .values({ name: "supplyscan-other", timezone: "Asia/Tokyo", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      otherHouseholdId = other!.id;
    });
    for (const [key, name, role, push] of [
      ["ally", "Ally Rivera", "member", true],
      ["mom", "Mom", "owner", true],
      ["dad", "Dad", "admin", true],
      ["sitter", "Sitter", "member", true],
      ["nopush", "NoPush", "member", false],
      ["stranger", "Stranger", "member", true],
    ] as const) {
      const p = await seedPerson(key, name, role, { push });
      userIds[key] = p.userId;
      memberIds[key] = p.memberId;
    }
    const o = await seedPerson("other", "Other", "owner", { household: otherHouseholdId });
    otherUserId = o.userId;
    otherMemberId = o.memberId;
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      for (const id of [householdId, otherHouseholdId]) if (id) await tx.delete(households).where(eq(households.id, id));
      if (cleanupUsers.length) await tx.delete(users).where(inArray(users.id, cleanupUsers));
    });
    await closeDb(db);
  });

  beforeEach(async () => {
    if (!db) return;
    vi.mocked(deliverWebPush).mockClear();
    for (const id of [householdId, otherHouseholdId]) {
      await withHouseholdContext(db, id, async (tx) => {
        await tx.delete(healthMedications).where(eq(healthMedications.householdId, id));
        await tx.delete(healthOrganizerPlans).where(eq(healthOrganizerPlans.householdId, id));
      });
    }
    await withHouseholdContext(db, householdId, (tx) => tx.delete(healthMemberAcl).where(eq(healthMemberAcl.householdId, householdId)));
    await withHouseholdContext(db, householdId, (tx) =>
      tx.insert(healthMemberAcl).values([
        { householdId, subjectMemberId: memberIds.ally!, granteeMemberId: memberIds.sitter!, medicationsAccess: "read" },
        { householdId, subjectMemberId: memberIds.ally!, granteeMemberId: memberIds.nopush!, medicationsAccess: "read" },
      ]),
    );
    await withWorkerScanContext(db, (tx) => tx.delete(userNotifications).where(inArray(userNotifications.userId, [...Object.values(userIds), otherUserId])));
    await withSystemContext(db, async (tx) => {
      await tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...Object.values(userIds), otherUserId]));
    });
  });

  async function addDevice(userKey: string) {
    await withSystemContext(db, (tx) =>
      tx.insert(pushSubscriptions).values({ userId: userIds[userKey]!, endpoint: `https://push.test/${randomUUID()}`, p256dh: "p", authKey: "a", timezone: "America/Chicago", platform: "web" }),
    );
  }

  describe("fill reminders", () => {
    it("waits for the plan's reminder time on the appointment's day, then tells the person with a link to the appointment", async () => {
      const plan = await makePlan();
      expect(await scan("2026-10-05T20:00:00Z")).toBe(0);
      expect(await scan("2026-10-06T13:59:00Z")).toBe(0);
      expect(await scan("2026-10-06T14:00:00Z")).toBe(1);

      const [row] = await inbox("ally", "health-fill-%");
      expect(row).toMatchObject({
        title: "Time to fill the pill organizer",
        url: `/health?fill=${plan.id}&appointment=2026-10-06&member=${memberIds.ally}`,
        tag: `health-fill-${plan.id}-2026-10-06`,
      });
      expect(await whoWasTold("health-fill-%")).toEqual(["ally"]);
    });

    it("follows a different reminder time", async () => {
      await makePlan({ reminderTime: "18:30" });
      expect(await scan("2026-10-06T23:29:00Z")).toBe(0);
      expect(await scan("2026-10-06T23:30:00Z")).toBe(1);
    });

    it("sends each reminder once, however often or however many scans run", async () => {
      await makePlan();
      expect(await scan("2026-10-06T14:00:00Z")).toBe(1);
      expect(await scan("2026-10-06T14:05:00Z")).toBe(0);
      expect(await scan("2026-10-06T20:00:00Z")).toBe(0);
      expect((await inbox("ally", "health-fill-%")).length).toBe(1);
    });

    it("cannot be sent twice by two scans running at the same moment", async () => {
      await makePlan({}, ["mom", "sitter"]);
      const counts = await Promise.all([scan("2026-10-06T14:00:00Z"), scan("2026-10-06T14:00:00Z"), scan("2026-10-06T14:00:00Z")]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
      const rows = await withHouseholdContext(db, householdId, (tx) => tx.select().from(healthSupplyFillReminderSent));
      expect(rows.filter((r) => [userIds.mom, userIds.sitter].includes(r.userId)).length).toBe(2);
      expect((await inbox("mom", "health-fill-%")).length).toBe(1);
      expect((await inbox("sitter", "health-fill-%")).length).toBe(1);
    });

    it("goes to the plan's selected caregivers rather than the person, each prefixed with the person's name", async () => {
      await makePlan({}, ["mom", "nopush"]);
      await scan("2026-10-06T14:00:00Z");
      expect(await whoWasTold("health-fill-%")).toEqual(["mom", "nopush"]);
      expect((await inbox("mom", "health-fill-%"))[0]!.title).toBe("Ally: Time to fill the pill organizer");
    });

    it("gives a caregiver the inbox notice, and a push only where their health reminders setting is on", async () => {
      await makePlan({}, ["mom", "nopush", "sitter"]);
      await addDevice("mom");
      await addDevice("nopush");
      await scan("2026-10-06T14:00:00Z");
      // sitter has push on but no device; nopush has a device but the setting is off; mom has both.
      expect(await whoWasTold("health-fill-%")).toEqual(["mom", "sitter", "nopush"].sort((a, b) => ["mom", "dad", "sitter", "nopush"].indexOf(a) - ["mom", "dad", "sitter", "nopush"].indexOf(b)).filter((k) => k !== "dad"));
      expect(pushCalls()).toBe(1);
    });

    it("sends nothing to a selected caregiver who may not read the person's medications, and rechecks it every time", async () => {
      await makePlan({}, ["mom", "stranger", "sitter"]);
      await scan("2026-10-06T14:00:00Z");
      expect(await whoWasTold("health-fill-%")).toEqual(["mom", "sitter"]);

      // Access taken away after the reminder was planned: the next appointment's reminder skips them.
      await withHouseholdContext(db, householdId, (tx) =>
        tx.delete(healthMemberAcl).where(and(eq(healthMemberAcl.granteeMemberId, memberIds.sitter!), eq(healthMemberAcl.subjectMemberId, memberIds.ally!))),
      );
      await scan("2026-11-05T15:00:00Z");
      expect((await inbox("sitter", "health-fill-%")).length).toBe(1);
      expect((await inbox("mom", "health-fill-%")).length).toBe(2);
    });

    it("sends nothing for an appointment that is done, skipped, missed or dealt with", async () => {
      const plan = await makePlan();
      for (const values of [{ outcome: "done" as const }, { outcome: "skipped" as const }, { outcome: "missed" as const }, { resolvedAt: new Date() }]) {
        await withHouseholdContext(db, householdId, async (tx) => {
          await tx.delete(healthOrganizerOccurrences).where(eq(healthOrganizerOccurrences.planId, plan.id));
          await tx.insert(healthOrganizerOccurrences).values({ planId: plan.id, occurrenceDate: "2026-10-06", ...values });
        });
        expect(await scan("2026-10-06T20:00:00Z")).toBe(0);
      }
    });

    it("sends nothing for an appointment a finished filling session covered", async () => {
      const plan = await makePlan();
      const occ = await withHouseholdContext(db, householdId, async (tx) => {
        const [o] = await tx.insert(healthOrganizerOccurrences).values({ planId: plan.id, occurrenceDate: "2026-10-06" }).returning({ id: healthOrganizerOccurrences.id });
        await tx.insert(healthOrganizerSessions).values({
          planId: plan.id,
          occurrenceId: o!.id,
          status: "finished",
          finishedAt: at("2026-10-06T13:00:00Z"),
          coverageStart: "2026-10-06",
          fillLengthDays: 31,
          snapshotJson: "{}",
          snapshotHash: "x",
        });
        return o!;
      });
      expect(occ.id).toBeTruthy();
      expect(await scan("2026-10-06T20:00:00Z")).toBe(0);
    });

    it("reminds on the new day for a moved appointment and not on its old one", async () => {
      const plan = await makePlan();
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthOrganizerOccurrences).values({ planId: plan.id, occurrenceDate: "2026-10-06", outcome: "rescheduled", rescheduledTo: "2026-10-09" }),
      );
      expect(await scan("2026-10-06T20:00:00Z")).toBe(0);
      expect(await scan("2026-10-09T13:59:00Z")).toBe(0);
      expect(await scan("2026-10-09T14:00:00Z")).toBe(1);
      const [row] = await inbox("ally", "health-fill-%");
      // Still identified by the day the schedule put it on, so the link opens the right appointment.
      expect(row!.tag).toBe(`health-fill-${plan.id}-2026-10-06`);
    });

    it("sends a reminder that came due while nothing was running on the next scan, once, and says it is late", async () => {
      await makePlan();
      // Nothing ran on Oct 6 at all; the first scan is that evening.
      expect(await scan("2026-10-07T01:00:00Z")).toBe(1);
      expect((await inbox("ally", "health-fill-%"))[0]!.title).toBe("Time to fill the pill organizer");
      expect(await scan("2026-10-07T01:05:00Z")).toBe(0);
    });

    it("says it was due when the first scan comes the day after, and lets a much older appointment go", async () => {
      await makePlan();
      expect(await scan("2026-10-07T15:00:00Z")).toBe(1);
      expect((await inbox("ally", "health-fill-%"))[0]!.title).toBe("Pill organizer fill was due");
      // A different plan person, whose first scan comes a week late: history, not news.
      await withHouseholdContext(db, householdId, (tx) => tx.delete(healthOrganizerPlans).where(eq(healthOrganizerPlans.householdId, householdId)));
      await makePlan({ memberId: memberIds.mom! });
      expect(await scan("2026-10-14T15:00:00Z")).toBe(0);
    });

    it("sends nothing when the plan has nobody selected to remind", async () => {
      await makePlan({}, []);
      expect(await scan("2026-10-06T20:00:00Z")).toBe(0);
    });

    it("sends nothing for an archived plan, or a household with the health module off", async () => {
      const plan = await makePlan();
      await withHouseholdContext(db, householdId, (tx) => tx.update(healthOrganizerPlans).set({ archivedAt: new Date() }).where(eq(healthOrganizerPlans.id, plan.id)));
      expect(await scan("2026-10-06T20:00:00Z")).toBe(0);
      await withHouseholdContext(db, householdId, (tx) => tx.update(healthOrganizerPlans).set({ archivedAt: null }).where(eq(healthOrganizerPlans.id, plan.id)));
      await withSystemContext(db, (tx) => tx.update(households).set({ modulesEnabled: JSON.stringify(["core"]) }).where(eq(households.id, householdId)));
      try {
        expect(await scan("2026-10-06T20:00:00Z")).toBe(0);
      } finally {
        await withSystemContext(db, (tx) => tx.update(households).set({ modulesEnabled: JSON.stringify(["core", "health"]) }).where(eq(households.id, householdId)));
      }
    });
  });

  describe("refill reminders", () => {
    // Runs out Oct 26 with a 7 day lead: the deadline is Oct 19, 09:00 = 14:00Z.
    it("goes at 9:00 on the deadline's day with a link to the supply record, once", async () => {
      const med = await makeMed({}, { runsOutOn: "2026-10-26" });
      expect(await scan("2026-10-19T13:59:00Z")).toBe(0);
      expect(await scan("2026-10-19T14:00:00Z")).toBe(1);
      expect(await scan("2026-10-19T14:05:00Z")).toBe(0);
      const [row] = await inbox("ally", "health-refill-%");
      expect(row).toMatchObject({
        title: "Time to refill Metformin",
        url: `/health?supply=${med.id}`,
        tag: `health-refill-${med.id}-1-refill`,
      });
      expect(row!.body).toContain("runs out in 7 days");
    });

    it("is due at once for an estimate entered inside the lead window", async () => {
      await makeMed({}, { runsOutOn: "2026-10-22" });
      expect(await scan("2026-10-20T01:00:00Z")).toBe(1);
    });

    it("sends the reminder that came due during downtime on the next scan, once", async () => {
      await makeMed({}, { runsOutOn: "2026-10-26" });
      expect(await scan("2026-10-22T05:00:00Z")).toBe(1);
      expect(await scan("2026-10-22T05:05:00Z")).toBe(0);
    });

    it("is silent for a requested refill, with one nudge two days before the supply runs out", async () => {
      const med = await makeMed({}, { runsOutOn: "2026-10-26", requestedAt: at("2026-10-19T15:00:00Z") });
      expect(await scan("2026-10-20T20:00:00Z")).toBe(0);
      expect(await scan("2026-10-24T13:59:00Z")).toBe(0);
      expect(await scan("2026-10-24T14:00:00Z")).toBe(1);
      expect(await scan("2026-10-25T20:00:00Z")).toBe(0);
      const [row] = await inbox("ally", "health-refill-%");
      expect(row).toMatchObject({ title: "Still waiting on Metformin", tag: `health-refill-${med.id}-1-waiting` });
      // And nothing after the supply has run out.
      expect(await scan("2026-10-28T20:00:00Z")).toBe(0);
    });

    it("stops when the refill is requested before the reminder goes", async () => {
      await makeMed({}, { runsOutOn: "2026-10-26", requestedAt: at("2026-10-18T15:00:00Z") });
      expect(await scan("2026-10-19T20:00:00Z")).toBe(0);
    });

    it("replaces the pending reminder when a new estimate moves the deadline, and reminds again for the new one", async () => {
      const med = await makeMed({}, { runsOutOn: "2026-10-26" });
      // A refill arrived and the estimate was redone before the old deadline: that deadline's reminder never goes.
      await withHouseholdContext(db, householdId, async (tx) => {
        await tx.update(healthMedicationSupply).set({ runsOutOn: "2026-12-10", revision: 2 }).where(eq(healthMedicationSupply.medicationId, med.id));
        await tx.insert(healthMedicationSupplyRevisions).values({ medicationId: med.id, revision: 2, source: "receipt", runsOutOn: "2026-12-10", estimatedOn: "2026-10-18", outsideDays: 0, organizerDaysCounted: 0 });
      });
      expect(await scan("2026-10-19T20:00:00Z")).toBe(0);
      expect(await scan("2026-12-03T16:00:00Z")).toBe(1);
      expect((await inbox("ally", "health-refill-%"))[0]!.tag).toBe(`health-refill-${med.id}-2-refill`);

      // A reminder already sent for revision 1 does not stop revision 2 reminding too.
      const sent = await withHouseholdContext(db, householdId, (tx) => tx.select().from(healthSupplyRefillReminderSent).where(eq(healthSupplyRefillReminderSent.medicationId, med.id)));
      expect(sent.map((r) => [r.revision, r.kind])).toEqual([[2, "refill"]]);
    });

    it("reminds again for a new revision even after the old one reminded", async () => {
      const med = await makeMed({}, { runsOutOn: "2026-10-26" });
      expect(await scan("2026-10-19T15:00:00Z")).toBe(1);
      await withHouseholdContext(db, householdId, async (tx) => {
        await tx.update(healthMedicationSupply).set({ runsOutOn: "2026-11-20", revision: 2 }).where(eq(healthMedicationSupply.medicationId, med.id));
        await tx.insert(healthMedicationSupplyRevisions).values({ medicationId: med.id, revision: 2, source: "manual", runsOutOn: "2026-11-20", estimatedOn: "2026-10-20", outsideDays: 0, organizerDaysCounted: 0 });
      });
      expect(await scan("2026-10-30T20:00:00Z")).toBe(0);
      expect(await scan("2026-11-13T16:00:00Z")).toBe(1);
      expect((await inbox("ally", "health-refill-%")).length).toBe(2);
    });

    it("sends nothing for a paused, deleted or finished medication, or one with no estimate", async () => {
      await makeMed({ name: "Paused", enabled: false }, { runsOutOn: "2026-10-26" });
      await makeMed({ name: "Deleted", deletedAt: new Date() }, { runsOutOn: "2026-10-26" });
      await makeMed({ name: "Ended", endDate: "2026-10-20" }, { runsOutOn: "2026-10-26" });
      await makeMed({ name: "None" });
      expect(await scan("2026-10-22T20:00:00Z")).toBe(0);
    });

    it("holds reminders back for an estimate that has to be confirmed after a pause", async () => {
      const med = await makeMed({}, { runsOutOn: "2026-10-26", revisedAt: at("2026-10-01T12:00:00Z") });
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthMedicationPauses).values({ medicationId: med.id, pausedAt: at("2026-10-05T12:00:00Z"), resumedAt: at("2026-10-10T12:00:00Z") }),
      );
      expect(await scan("2026-10-22T20:00:00Z")).toBe(0);
    });

    it("uses the person's own lead time, and the medication's when it has one", async () => {
      await makeMed({ name: "Own" }, { runsOutOn: "2026-10-26", leadDays: 10 });
      expect(await scan("2026-10-15T13:59:00Z")).toBe(0);
      expect(await scan("2026-10-16T14:00:00Z")).toBe(1);
    });

    it("uses the person's default lead time when the medication has none of its own", async () => {
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthSupplySettings).values({ memberId: memberIds.ally!, householdId, defaultLeadDays: 14 }).onConflictDoUpdate({ target: healthSupplySettings.memberId, set: { defaultLeadDays: 14 } }),
      );
      try {
        await makeMed({}, { runsOutOn: "2026-10-26", leadDays: null });
        expect(await scan("2026-10-12T13:59:00Z")).toBe(0);
        expect(await scan("2026-10-12T14:00:00Z")).toBe(1);
      } finally {
        await withHouseholdContext(db, householdId, (tx) => tx.delete(healthSupplySettings).where(eq(healthSupplySettings.memberId, memberIds.ally!)));
      }
    });

    it("goes to the plan's caregivers who may see the medication, prefixed with the person, and to nobody who may not", async () => {
      await makePlan({}, ["mom", "dad", "sitter", "stranger"]);
      const med = await makeMed({ name: "Private", visibility: "private", createdByUserId: userIds.ally! }, { runsOutOn: "2026-10-26" });
      await scan("2026-10-19T15:00:00Z");
      // A private medication: dad is an admin but has no override, mom is an owner (same), sitter has medications read, stranger nothing.
      expect(await whoWasTold("health-refill-%")).toEqual(["sitter"]);
      expect((await inbox("sitter", "health-refill-%"))[0]!.title).toBe("Ally: Time to refill Private");

      // Shared with mom: now she sees it, and gets the next medication's reminder as well.
      await withHouseholdContext(db, householdId, (tx) => tx.insert(healthMedicationShares).values({ medicationId: med.id, memberId: memberIds.mom! }));
      const med2 = await makeMed({ name: "Household" }, { runsOutOn: "2026-10-26" });
      await scan("2026-10-19T15:05:00Z");
      const told = await whoWasTold(`health-refill-${med2.id}-%`);
      expect(told).toEqual(["mom", "dad", "sitter"]);
      expect(await whoWasTold(`health-refill-${med.id}-%`)).toEqual(["mom", "sitter"]);
    });

    it("reminds the person themself when they have no organizer plan, and nobody when the plan selects no one", async () => {
      await makeMed({}, { runsOutOn: "2026-10-26" });
      expect(await scan("2026-10-19T15:00:00Z")).toBe(1);
      expect(await whoWasTold("health-refill-%")).toEqual(["ally"]);
      await withSystemContext(db, (tx) => tx.delete(userNotifications).where(inArray(userNotifications.userId, Object.values(userIds))));
      await makePlan({}, []);
      await withHouseholdContext(db, householdId, (tx) => tx.delete(healthSupplyRefillReminderSent));
      expect(await scan("2026-10-19T15:05:00Z")).toBe(0);
    });

    it("sends nothing to a caregiver whose access was taken away", async () => {
      await makePlan({}, ["sitter"]);
      await makeMed({}, { runsOutOn: "2026-10-26" });
      await withHouseholdContext(db, householdId, (tx) => tx.delete(healthMemberAcl).where(eq(healthMemberAcl.granteeMemberId, memberIds.sitter!)));
      expect(await scan("2026-10-19T15:00:00Z")).toBe(0);
      expect(await whoWasTold("health-refill-%")).toEqual([]);
    });

    it("sends the inbox notice to everyone and a push only to devices of people whose setting is on", async () => {
      await makePlan({}, ["mom", "nopush"]);
      await addDevice("mom");
      await addDevice("nopush");
      await makeMed({}, { runsOutOn: "2026-10-26" });
      await scan("2026-10-19T15:00:00Z");
      expect(await whoWasTold("health-refill-%")).toEqual(["mom", "nopush"]);
      expect(pushCalls()).toBe(1);
    });
  });

  describe("households", () => {
    it("a scan for one household sends nothing for another, in whatever time zone it is on", async () => {
      await makePlan();
      // The other household is in Tokyo and has its own plan, due at 09:00 JST = 00:00Z.
      await withHouseholdContext(db, otherHouseholdId, async (tx) => {
        const [p] = await tx
          .insert(healthOrganizerPlans)
          .values({ householdId: otherHouseholdId, memberId: otherMemberId, scheduleKind: "every_n_days", everyN: 30, anchorDate: "2026-10-06", reminderTime: "09:00" })
          .returning({ id: healthOrganizerPlans.id });
        await tx.insert(healthOrganizerPlanCaregivers).values({ planId: p!.id, memberId: otherMemberId });
      });
      expect(await scan("2026-10-06T00:30:00Z", householdId)).toBe(0); // Chicago: still Oct 5
      expect(await scan("2026-10-06T00:30:00Z", otherHouseholdId)).toBe(1);
      expect(await whoWasTold("health-fill-%")).toEqual([]);
      const rows = await withWorkerScanContext(db, (tx) => tx.select().from(userNotifications).where(eq(userNotifications.userId, otherUserId)));
      expect(rows.length).toBe(1);
      // And the first household's own time comes later, untouched by the other's.
      expect(await scan("2026-10-06T14:00:00Z", householdId)).toBe(1);
      expect(await scan("2026-10-06T14:00:00Z", otherHouseholdId)).toBe(0);
    });
  });
});
