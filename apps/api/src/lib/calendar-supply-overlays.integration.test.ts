import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthMedicationSupply,
  healthMedications,
  healthMemberAcl,
  healthOrganizerOccurrences,
  healthOrganizerPlanCaregivers,
  healthOrganizerPlans,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import { buildAllCalendarOverlays, buildSupplyOverlays } from "./calendar-overlays.js";

/**
 * WHO-430: the calendar shows a person's pill organizer fill appointments and their medications' refill deadlines.
 * Runs as the app role against a real Postgres; skipped without one. Today is pinned to 2026-10-06 (UTC household).
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = {
  MODULES_ENABLED: ["core", "health"],
  DEPLOYMENT_MODE: "single",
  AUTH_REQUIRED: true,
  ENCRYPTION_KEY: "test-health-encryption-key-32chars!!",
} as unknown as Env;

const TODAY = "2026-10-06";
const RANGE_FROM = "2026-09-01";
const RANGE_TO = "2026-12-31";

type Who = { userId: string; memberId: string; role: string };

maybeDescribe("health_supply calendar overlays (integration)", () => {
  let db: Database;
  let householdId = "";
  let mom: Who; // owner
  let dad: Who; // admin
  let ally: Who; // the person with the organizer
  let gran: Who; // caregiver with read access to ally's medications
  let sam: Who; // caregiver picked on the plan but with no access
  let stranger: Who; // no access at all
  let planId = "";
  const userIds: string[] = [];

  const auth = (w: Who) => ({ householdId, userId: w.userId, memberId: w.memberId, role: w.role });
  const chips = (w: Who, from = RANGE_FROM, to = RANGE_TO) => withHouseholdContext(db, householdId, (tx) => buildSupplyOverlays(tx, env, auth(w), from, to));
  const appointments = async (w: Who) => (await chips(w)).filter((c) => c.id.startsWith("overlay:health:appointment:"));
  const refills = async (w: Who) => (await chips(w)).filter((c) => c.id.startsWith("overlay:health:refill:"));

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "who430-home", timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdId = hh.id;
      const member = async (name: string, role: "owner" | "child" | "admin"): Promise<Who> => {
        const [u] = await tx
          .insert(users)
          .values({ email: `who430-${randomUUID()}@test.local`, displayName: name, emailVerified: true })
          .returning({ id: users.id });
        userIds.push(u.id);
        const [m] = await tx.insert(householdMembers).values({ householdId, userId: u.id, role, name }).returning({ id: householdMembers.id });
        return { userId: u.id, memberId: m.id, role };
      };
      mom = await member("mom", "owner");
      dad = await member("dad", "admin");
      ally = await member("ally", "child");
      gran = await member("gran", "child");
      sam = await member("sam", "child");
      stranger = await member("stranger", "child");
    });
    await withHouseholdContext(db, householdId, async (tx) => {
      await tx.insert(healthMemberAcl).values({ householdId, subjectMemberId: ally.memberId, granteeMemberId: gran.memberId, medicationsAccess: "read" });
      const [plan] = await tx
        .insert(healthOrganizerPlans)
        .values({ householdId, memberId: ally.memberId, scheduleKind: "every_n_days", everyN: 30, anchorDate: TODAY, fillLengthDays: 31 })
        .returning({ id: healthOrganizerPlans.id });
      planId = plan.id;
      await tx.insert(healthOrganizerPlanCaregivers).values([
        { planId, memberId: mom.memberId },
        { planId, memberId: gran.memberId },
        { planId, memberId: sam.memberId },
      ]);
    });
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(db);
  });

  const setToday = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${iso}T12:00:00.000Z`));
  };
  beforeEach(() => setToday(TODAY));
  afterEach(async () => {
    vi.useRealTimers();
    await withHouseholdContext(db, householdId, async (tx) => {
      await tx.delete(healthOrganizerOccurrences).where(eq(healthOrganizerOccurrences.planId, planId));
      await tx.delete(healthMedications).where(eq(healthMedications.householdId, householdId));
    });
  });

  const addMed = (opts: {
    name: string;
    runsOutOn?: string | null;
    memberId?: string;
    visibility?: "household" | "private";
    createdBy?: Who;
    enabled?: boolean;
    deleted?: boolean;
    endDate?: string | null;
    requested?: boolean;
  }) =>
    withHouseholdContext(db, householdId, async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({
          householdId,
          memberId: opts.memberId ?? ally.memberId,
          name: opts.name,
          scheduleKind: "scheduled",
          scheduleJson: JSON.stringify({ times: ["08:00"] }),
          visibility: opts.visibility ?? "household",
          createdByUserId: opts.createdBy?.userId ?? null,
          enabled: opts.enabled ?? true,
          deletedAt: opts.deleted ? new Date() : null,
          endDate: opts.endDate ?? null,
        })
        .returning({ id: healthMedications.id });
      if (opts.runsOutOn !== undefined) {
        await tx.insert(healthMedicationSupply).values({
          medicationId: m.id,
          runsOutOn: opts.runsOutOn,
          estimatedOn: TODAY,
          revision: 1,
          leadDays: 5,
          requestedAt: opts.requested ? new Date() : null,
        });
      }
      return m.id;
    });

  const setOutcome = (nominalDate: string, values: Partial<typeof healthOrganizerOccurrences.$inferInsert>) =>
    withHouseholdContext(db, householdId, (tx) =>
      tx.insert(healthOrganizerOccurrences).values({ planId, occurrenceDate: nominalDate, ...values }).onConflictDoNothing(),
    );

  describe("fill appointments", () => {
    it("shows the organizer's appointments to people who may read the person's medications, and to nobody else", async () => {
      const seen = async (w: Who) => (await appointments(w)).map((c) => c.startDate);
      expect(await seen(mom)).toEqual(expect.arrayContaining([TODAY, "2026-11-05", "2026-12-05"]));
      expect(await seen(dad)).toContain(TODAY);
      expect(await seen(ally)).toContain(TODAY);
      expect(await seen(gran)).toContain(TODAY);
      expect(await seen(sam)).toEqual([]);
      expect(await seen(stranger)).toEqual([]);
    });

    it("is an all-day chip with the supply overlay's identity and a link to the appointment", async () => {
      const chip = (await appointments(mom)).find((c) => c.startDate === TODAY)!;
      expect(chip).toMatchObject({
        title: "Fill pill organizer",
        allDay: true,
        startTime: null,
        source: "health_supply",
        overlayKind: "health_supply",
        calendarId: "__overlay_health_supply__",
        editable: false,
        deepLink: `/health?fill=${planId}&appointment=${TODAY}`,
        id: `overlay:health:appointment:${planId}:${TODAY}`,
      });
    });

    it("lists the person and the caregivers who may see their medications, not a caregiver without access", async () => {
      const chip = (await appointments(mom)).find((c) => c.startDate === TODAY)!;
      expect([...chip.attendeeMemberIds!].sort()).toEqual([ally.memberId, mom.memberId, gran.memberId].sort());
      expect(chip.attendeeMemberIds).not.toContain(sam.memberId);
    });

    it("keeps an appointment that is overdue until it is dealt with, then drops it", async () => {
      setToday("2026-10-08");
      expect((await appointments(mom)).map((c) => c.startDate)).toContain(TODAY);
      await setOutcome(TODAY, { resolvedAt: new Date() });
      expect((await appointments(mom)).map((c) => c.startDate)).not.toContain(TODAY);
    });

    for (const outcome of ["done", "skipped", "missed"] as const) {
      it(`drops an appointment marked ${outcome}`, async () => {
        await setOutcome(TODAY, { outcome, outcomeChangedAt: new Date() });
        const days = (await appointments(mom)).map((c) => c.startDate);
        expect(days).not.toContain(TODAY);
        expect(days).toContain("2026-11-05");
      });
    }

    it("moves a rescheduled appointment to its new day and says so", async () => {
      await setOutcome(TODAY, { outcome: "rescheduled", rescheduledTo: "2026-10-09", outcomeChangedAt: new Date() });
      const list = await appointments(mom);
      expect(list.find((c) => c.startDate === TODAY)).toBeUndefined();
      const moved = list.find((c) => c.startDate === "2026-10-09")!;
      expect(moved.title).toBe("Fill pill organizer (moved)");
      // Still identified by the day the schedule put it on, so the link opens the right appointment.
      expect(moved.deepLink).toBe(`/health?fill=${planId}&appointment=${TODAY}`);
    });

    it("puts an appointment back when it is set to pending again", async () => {
      await setOutcome(TODAY, { outcome: "skipped", outcomeChangedAt: new Date() });
      expect((await appointments(mom)).map((c) => c.startDate)).not.toContain(TODAY);
      await withHouseholdContext(db, householdId, (tx) =>
        tx.update(healthOrganizerOccurrences).set({ outcome: "pending" }).where(eq(healthOrganizerOccurrences.planId, planId)),
      );
      expect((await appointments(mom)).map((c) => c.startDate)).toContain(TODAY);
    });

    it("only lists days in the range asked for", async () => {
      const days = (await chips(mom, "2026-11-01", "2026-11-30")).filter((c) => c.id.includes("appointment")).map((c) => c.startDate);
      expect(days).toEqual(["2026-11-05"]);
    });

    it("shows nothing for an archived plan", async () => {
      await withHouseholdContext(db, householdId, (tx) => tx.update(healthOrganizerPlans).set({ archivedAt: new Date() }).where(eq(healthOrganizerPlans.id, planId)));
      try {
        expect(await appointments(mom)).toEqual([]);
      } finally {
        await withHouseholdContext(db, householdId, (tx) => tx.update(healthOrganizerPlans).set({ archivedAt: null }).where(eq(healthOrganizerPlans.id, planId)));
      }
    });
  });

  describe("refill deadlines", () => {
    // Lead time is 5 days, so a supply that runs out on 2026-10-26 has to be refilled by 2026-10-21.
    it("puts a chip on the deadline of each medication the viewer may see, carrying the person", async () => {
      const id = await addMed({ name: "Metformin", runsOutOn: "2026-10-26" });
      const chip = (await refills(stranger)).find((c) => c.id.includes(id))!;
      expect(chip).toMatchObject({
        title: "Refill Metformin",
        startDate: "2026-10-21",
        allDay: true,
        source: "health_supply",
        overlayKind: "health_supply",
        deepLink: `/health?supply=${id}`,
        id: `overlay:health:refill:${id}:2026-10-21`,
      });
      // Household-visible, so everyone who can see the medication sees it; the person and the caregivers who can see it are the attendees.
      expect([...chip.attendeeMemberIds!].sort()).toEqual([ally.memberId, mom.memberId, gran.memberId, sam.memberId].sort());
    });

    it("keeps a requested refill, marked, until it is received and the deadline moves", async () => {
      const id = await addMed({ name: "Lisinopril", runsOutOn: "2026-10-26", requested: true });
      expect((await refills(mom)).find((c) => c.id.includes(id))?.title).toBe("Refill Lisinopril (requested)");
      await withHouseholdContext(db, householdId, (tx) =>
        tx.update(healthMedicationSupply).set({ runsOutOn: "2026-12-20", requestedAt: null, receivedAt: new Date(), revision: 2 }).where(eq(healthMedicationSupply.medicationId, id)),
      );
      const after = (await refills(mom)).filter((c) => c.id.includes(id));
      expect(after.map((c) => [c.startDate, c.title])).toEqual([["2026-12-15", "Refill Lisinopril"]]);
    });

    it("has no deadline for a paused, deleted or finished medication, or one with no estimate", async () => {
      const paused = await addMed({ name: "Paused", runsOutOn: "2026-10-26", enabled: false });
      const deleted = await addMed({ name: "Deleted", runsOutOn: "2026-10-26", deleted: true });
      const ended = await addMed({ name: "Ended", runsOutOn: "2026-10-26", endDate: "2026-10-10" });
      const none = await addMed({ name: "NoEstimate" });
      const open = await addMed({ name: "Open", runsOutOn: "2026-10-26" });
      const ids = (await refills(mom)).map((c) => c.id);
      for (const id of [paused, deleted, ended, none]) expect(ids.some((i) => i.includes(id))).toBe(false);
      expect(ids.some((i) => i.includes(open))).toBe(true);
    });

    it("keeps a private medication's deadline from people who cannot see the medication, caregivers included", async () => {
      const id = await addMed({ name: "Private", runsOutOn: "2026-10-26", visibility: "private", createdBy: dad });
      const seenBy = async (w: Who) => (await refills(w)).some((c) => c.id.includes(id));
      expect(await seenBy(dad)).toBe(true); // made it
      expect(await seenBy(ally)).toBe(true); // it is theirs
      expect(await seenBy(gran)).toBe(true); // medications read on ally
      expect(await seenBy(mom)).toBe(false); // owner, but no admin override of private records
      expect(await seenBy(sam)).toBe(false);
      expect(await seenBy(stranger)).toBe(false);
      // mom is a caregiver on the plan but cannot see the medication, so she is not listed on its chip.
      const chip = (await refills(dad)).find((c) => c.id.includes(id))!;
      expect(chip.attendeeMemberIds).toContain(ally.memberId);
      expect(chip.attendeeMemberIds).toContain(gran.memberId);
      expect(chip.attendeeMemberIds).not.toContain(mom.memberId);
      expect(chip.attendeeMemberIds).not.toContain(sam.memberId);
    });

    it("only lists deadlines in the range asked for", async () => {
      const id = await addMed({ name: "Ranged", runsOutOn: "2026-10-26" });
      const inRange = (await chips(mom, "2026-10-21", "2026-10-21")).some((c) => c.id.includes(id));
      const before = (await chips(mom, "2026-10-01", "2026-10-20")).some((c) => c.id.includes(id));
      const after = (await chips(mom, "2026-10-22", "2026-11-30")).some((c) => c.id.includes(id));
      expect([inRange, before, after]).toEqual([true, false, false]);
    });

    it("lists only the person for a medication of someone with no organizer", async () => {
      const id = await addMed({ name: "Dads", runsOutOn: "2026-10-26", memberId: dad.memberId });
      const chip = (await refills(mom)).find((c) => c.id.includes(id))!;
      expect(chip.attendeeMemberIds).toEqual([dad.memberId]);
    });
  });

  describe("the medication overlay setting", () => {
    it("follows the existing medication preference: on shows both, off shows neither", async () => {
      await addMed({ name: "Setting", runsOutOn: "2026-10-26" });
      const run = (healthMeds: boolean) =>
        withHouseholdContext(db, householdId, (tx) =>
          buildAllCalendarOverlays(tx, env, auth(mom), RANGE_FROM, RANGE_TO, { school: false, health: true }, { school: false, healthEvents: false, healthMeds }),
        );
      const on = (await run(true)).filter((c) => c.overlayKind === "health_supply");
      expect(on.some((c) => c.id.includes("appointment"))).toBe(true);
      expect(on.some((c) => c.id.includes("refill"))).toBe(true);
      expect((await run(false)).filter((c) => c.overlayKind === "health_supply")).toEqual([]);
    });

    it("is absent when the health module is off", async () => {
      const list = await withHouseholdContext(db, householdId, (tx) =>
        buildAllCalendarOverlays(tx, env, auth(mom), RANGE_FROM, RANGE_TO, { school: false, health: false }, { school: false, healthEvents: true, healthMeds: true }),
      );
      expect(list.filter((c) => c.overlayKind === "health_supply")).toEqual([]);
    });
  });
});
