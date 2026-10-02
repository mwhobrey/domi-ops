import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, like } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthCheckLogs,
  healthCheckPauses,
  healthCheckReminderSent,
  healthChecks,
  healthEvents,
  healthMemberAcl,
  healthVitalsReadings,
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
import { scanHealthCheckReminders } from "./health-check-reminder-scan.js";
import {
  listHealthCheckReminderRecipients,
  listHealthMedReminderRecipients,
} from "./health-med-reminder-recipients.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

// No VAPID keys: delivery only writes the inbox row, so nothing leaves the process.
const env = { ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" } as Env;
const BP = ["blood_pressure_systolic", "blood_pressure_diastolic"];

/**
 * WHO-386: the health check reminder scan against a real Postgres, with an injected clock. The
 * household is on Chicago time and the check is at 12:05 local, which on 2026-10-02 (CDT, UTC-5)
 * is 17:05Z, so `17:00Z` is the "slot five minutes out" case.
 */
maybeDescribe("scanHealthCheckReminders (integration)", () => {
  let db: Database;
  let householdId: string;
  const userIds: Record<string, string> = {};
  const memberIds: Record<string, string> = {};

  const at = (iso: string) => new Date(iso);

  /** Reminders recorded for this test's household. */
  const remindersRecorded = () =>
    withWorkerScanContext(db, async (tx) => {
      const [row] = await tx
        .select({ n: count() })
        .from(healthCheckReminderSent)
        .innerJoin(healthChecks, eq(healthChecks.id, healthCheckReminderSent.checkId))
        .where(eq(healthChecks.householdId, householdId));
      return row!.n;
    });

  /**
   * Run the scan on this test's household and report how many reminders it delivered. The scan is
   * cross-tenant by design, so scoping it keeps other suites that share the database (and delete
   * their own households while it sweeps) from changing or breaking these tests. The worker's
   * sweep is this same code with the household filter left off.
   */
  async function scan(iso: string): Promise<number> {
    const before = await remindersRecorded();
    await withWorkerScanContext(db, (tx) => scanHealthCheckReminders(tx, env, { now: at(iso), householdId }));
    return (await remindersRecorded()) - before;
  }

  async function seedPerson(key: string, name: string, role: "owner" | "admin" | "member", push = true) {
    await withSystemContext(db, async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: `checkscan-${key}-${randomUUID()}@test.local`,
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

  async function makeCheck(over: Partial<typeof healthChecks.$inferInsert> = {}) {
    const [row] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthChecks)
        .values({
          householdId,
          memberId: memberIds.ally!,
          name: "Ally BP",
          eventType: "vitals",
          templateJson: JSON.stringify({ metrics: BP }),
          scheduleJson: JSON.stringify({ times: ["12:05"] }),
          reminderOffsetsJson: "[0]",
          ...over,
        })
        .returning(),
    );
    return row!;
  }

  async function makeReading(iso: string, over: { memberKey?: string; metrics?: string[] } = {}) {
    const [row] = await withHouseholdContext(db, householdId, async (tx) => {
      const [ev] = await tx
        .insert(healthEvents)
        .values({
          householdId,
          memberId: memberIds[over.memberKey ?? "ally"]!,
          type: "vitals",
          title: "checkscan reading",
          startedAt: at(iso),
        })
        .returning({ id: healthEvents.id });
      for (const metric of over.metrics ?? BP) {
        await tx.insert(healthVitalsReadings).values({ eventId: ev!.id, metric: metric as never, value: "1", unit: "x" });
      }
      return [ev!];
    });
    return row!.id;
  }

  const inbox = (userKey: string, checkId: string) =>
    withWorkerScanContext(db, (tx) =>
      tx
        .select()
        .from(userNotifications)
        .where(and(eq(userNotifications.userId, userIds[userKey]!), like(userNotifications.tag, `health-check-${checkId}-%`))),
    );
  const sentRows = (checkId: string) =>
    withWorkerScanContext(db, (tx) =>
      tx.select().from(healthCheckReminderSent).where(eq(healthCheckReminderSent.checkId, checkId)),
    );
  const everyone = ["ally", "mom", "dad", "sitter", "nopush", "stranger"];
  const whoWasTold = async (checkId: string) => {
    const told: string[] = [];
    for (const key of everyone) if ((await inbox(key, checkId)).length > 0) told.push(key);
    return told;
  };

  async function addDevice(userKey: string, timezone: string) {
    const [row] = await withSystemContext(db, (tx) =>
      tx
        .insert(pushSubscriptions)
        .values({ userId: userIds[userKey]!, endpoint: `https://push.test/${randomUUID()}`, p256dh: "p", authKey: "a", timezone, platform: "web" })
        .returning({ id: pushSubscriptions.id }),
    );
    return row!.id;
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "checkscan-it", timezone: "America/Chicago", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdId = hh.id;
    });
    await seedPerson("ally", "Ally", "member");
    await seedPerson("mom", "Mom", "owner");
    await seedPerson("dad", "Dad", "admin");
    await seedPerson("sitter", "Sitter", "member");
    await seedPerson("nopush", "NoPush", "member", false);
    await seedPerson("stranger", "Stranger", "member");
    await withHouseholdContext(db, householdId, (tx) =>
      tx.insert(healthMemberAcl).values([
        { householdId, subjectMemberId: memberIds.ally!, granteeMemberId: memberIds.mom!, eventsAccess: "write" },
        { householdId, subjectMemberId: memberIds.ally!, granteeMemberId: memberIds.dad!, eventsAccess: "read" },
        { householdId, subjectMemberId: memberIds.ally!, granteeMemberId: memberIds.sitter!, dosesAccess: "write" },
        { householdId, subjectMemberId: memberIds.ally!, granteeMemberId: memberIds.nopush!, eventsAccess: "write" },
      ]),
    );
  }, 30_000);

  beforeEach(async () => {
    if (!db) return;
    await withHouseholdContext(db, householdId, async (tx) => {
      await tx.delete(healthEvents).where(eq(healthEvents.householdId, householdId));
      await tx.delete(healthChecks).where(eq(healthChecks.householdId, householdId));
    });
    await withWorkerScanContext(db, async (tx) => {
      await tx.delete(userNotifications).where(eq(userNotifications.householdId, householdId));
      await tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, Object.values(userIds)));
    });
    await withSystemContext(db, (tx) =>
      tx.update(households).set({ modulesEnabled: JSON.stringify(["core", "health"]) }).where(eq(households.id, householdId)),
    );
  });

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      const ids = Object.values(userIds);
      if (ids.length) await tx.delete(users).where(inArray(users.id, ids));
    });
    await closeDb(db);
  });

  describe("who is reminded", () => {
    it("the person and caregivers with events write: a slot five minutes out", async () => {
      const check = await makeCheck();
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(2);

      const ally = (await inbox("ally", check.id))[0]!;
      const mom = (await inbox("mom", check.id))[0]!;
      expect(ally).toMatchObject({ title: "Health check • 12:05 PM", body: "Ally BP at 12:05 PM" });
      expect(ally.url).toBe(`/health?check=${check.id}&scheduledAt=2026-10-02T17%3A05%3A00.000Z`);
      // A caregiver is told whose check it is.
      expect(mom.body).toBe("Ally — Ally BP at 12:05 PM");

      // Read-only on events, writes doses only, push turned off, no relationship: nobody else.
      expect(await whoWasTold(check.id)).toEqual(["ally", "mom"]);
      const sent = await sentRows(check.id);
      expect(sent).toHaveLength(2);
      expect(sent.every((s) => s.offsetMinutes === 0 && s.subscriptionId === null)).toBe(true);
    });

    it("recipients come from the events segment for checks and the doses segment for medications", async () => {
      const subject = { householdId, subjectMemberId: memberIds.ally! };
      const checks = await withWorkerScanContext(db, (tx) => listHealthCheckReminderRecipients(tx, subject));
      expect(checks.subjectLabel).toBe("Ally");
      expect(checks.recipients.map((r) => [r.userId, r.isSubject]).sort()).toEqual(
        [[userIds.ally, true], [userIds.mom, false]].sort(),
      );
      const meds = await withWorkerScanContext(db, (tx) => listHealthMedReminderRecipients(tx, subject));
      expect(meds.recipients.map((r) => r.userId).sort()).toEqual([userIds.ally, userIds.sitter].sort());
    });

    it("nobody to tell is not an error", async () => {
      // Its own person with push off and nobody with write on them.
      const check = await makeCheck({ memberId: memberIds.nopush! });
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(0);
      expect(await sentRows(check.id)).toHaveLength(0);
    });
  });

  describe("each reminder is sent once", () => {
    it("a rescan, and later scans inside the same window, add nothing", async () => {
      const check = await makeCheck();
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(2);
      for (const later of ["2026-10-02T17:00:00.000Z", "2026-10-02T17:02:00.000Z", "2026-10-02T17:04:00.000Z"]) {
        expect(await scan(later), later).toBe(0);
      }
      expect(await inbox("ally", check.id)).toHaveLength(1);
      expect(await sentRows(check.id)).toHaveLength(2);
    });

    it("once the slot is due the copy says so", async () => {
      const check = await makeCheck();
      expect(await scan("2026-10-02T17:07:00.000Z")).toBe(2);
      expect((await inbox("ally", check.id))[0]!.body).toBe("Time to check Ally BP at 12:05 PM");
    });
  });

  describe("an answered slot gets no reminder", () => {
    it("a reading logged from the Log tab near the slot", async () => {
      const check = await makeCheck();
      await makeReading("2026-10-02T16:58:00.000Z"); // 7 minutes before the slot
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(0);
      expect(await whoWasTold(check.id)).toEqual([]);
    });

    it("but a reading that is not a blood pressure, or is someone else's, does not count", async () => {
      const check = await makeCheck();
      await makeReading("2026-10-02T16:58:00.000Z", { metrics: ["weight"] });
      await makeReading("2026-10-02T16:59:00.000Z", { memberKey: "mom" });
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(2);
      expect(await whoWasTold(check.id)).toEqual(["ally", "mom"]);
    });

    it("a slot completed through the check, however far off the reading was", async () => {
      const check = await makeCheck();
      const reading = await makeReading("2026-10-02T03:00:00.000Z");
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthCheckLogs).values({ checkId: check.id, scheduledAt: at("2026-10-02T17:05:00.000Z"), status: "done", healthEventId: reading }),
      );
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(0);
    });

    it("a slot that was skipped on purpose", async () => {
      const check = await makeCheck();
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthCheckLogs).values({ checkId: check.id, scheduledAt: at("2026-10-02T17:05:00.000Z"), status: "skipped" }),
      );
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(0);
    });

    it("a reading logged early, before the advance reminder, cancels it", async () => {
      const check = await makeCheck({ reminderOffsetsJson: "[0, 15]" });
      await makeReading("2026-10-02T16:40:00.000Z"); // 25 minutes before the slot, inside the 30-minute tolerance
      expect(await scan("2026-10-02T16:50:00.000Z")).toBe(0);
      expect(await scan("2026-10-02T17:02:00.000Z")).toBe(0);
      expect(await whoWasTold(check.id)).toEqual([]);
    });
  });

  describe("offsets and the overdue nudge", () => {
    it("sends the early reminder first and the on-time one later", async () => {
      const check = await makeCheck({ reminderOffsetsJson: "[0, 15]" });
      expect(await scan("2026-10-02T16:50:00.000Z")).toBe(2); // 15 minutes out: the early one
      expect((await sentRows(check.id)).map((s) => s.offsetMinutes)).toEqual([15, 15]);
      expect(await scan("2026-10-02T17:02:00.000Z")).toBe(2); // the on-time one
      expect((await sentRows(check.id)).map((s) => s.offsetMinutes).sort((a, b) => a - b)).toEqual([0, 0, 15, 15]);
    });

    it("nudges once when the slot goes overdue, then leaves it alone", async () => {
      const check = await makeCheck();
      expect(await scan("2026-10-02T17:36:00.000Z")).toBe(2); // 31 minutes after the slot, unanswered
      const nudge = (await inbox("ally", check.id))[0]!;
      expect(nudge).toMatchObject({ title: "Health check overdue • 12:05 PM", body: "Ally BP at 12:05 PM hasn't been logged yet" });
      expect((await sentRows(check.id)).every((s) => s.offsetMinutes === -30)).toBe(true);
      expect(await scan("2026-10-02T17:40:00.000Z")).toBe(0);
      // Long after, the window has passed: no late nudge.
      expect(await scan("2026-10-02T19:00:00.000Z")).toBe(0);
    });

    it("an overdue slot that got answered meanwhile is not nudged", async () => {
      const check = await makeCheck();
      await makeReading("2026-10-02T17:20:00.000Z"); // 15 minutes after, still inside the tolerance
      expect(await scan("2026-10-02T17:36:00.000Z")).toBe(0);
      expect(await whoWasTold(check.id)).toEqual([]);
    });
  });

  describe("checks that do not remind", () => {
    it("paused, deleted, before the start date, after the end date, or inside a pause", async () => {
      const paused = await makeCheck({ name: "paused", enabled: false });
      const deleted = await makeCheck({ name: "deleted", deletedAt: at("2026-10-01T00:00:00.000Z"), enabled: false });
      const notYet = await makeCheck({ name: "notyet", startDate: "2026-10-03" });
      const over = await makeCheck({ name: "over", endDate: "2026-10-01" });
      const inPause = await makeCheck({ name: "inpause" });
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthCheckPauses).values({ checkId: inPause.id, pausedAt: at("2026-10-02T00:00:00.000Z") }),
      );
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(0);
      for (const c of [paused, deleted, notYet, over, inPause]) expect(await sentRows(c.id), c.name).toHaveLength(0);
    });

    it("a deleted check, even if it were somehow still enabled and its slot predates the deletion", async () => {
      // The other guards overlap (deleted implies disabled, and slots after deletion are dropped), so
      // this isolates the one on the query itself.
      const check = await makeCheck({ name: "deleted but enabled", enabled: true, deletedAt: at("2026-10-03T00:00:00.000Z") });
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(0);
      expect(await sentRows(check.id)).toHaveLength(0);
    });

    it("a household with the health module off", async () => {
      const check = await makeCheck();
      await withSystemContext(db, (tx) =>
        tx.update(households).set({ modulesEnabled: JSON.stringify(["core"]) }).where(eq(households.id, householdId)),
      );
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(0);
      expect(await sentRows(check.id)).toHaveLength(0);
    });
  });

  describe("devices and time zones", () => {
    it("reminds each device at the slot in its own time zone, and the household's zone when there is no device", async () => {
      const check = await makeCheck();
      const nyDevice = await addDevice("ally", "America/New_York"); // 12:05 there is 16:05Z
      // 16:00Z: five minutes before the slot on Ally's phone. Mom has no device, so Chicago time
      // applies to her and her 12:05 is still an hour away.
      expect(await scan("2026-10-02T16:00:00.000Z")).toBe(1);
      expect(await whoWasTold(check.id)).toEqual(["ally"]);
      const allyRows = await sentRows(check.id);
      expect(allyRows).toHaveLength(1);
      expect(allyRows[0]).toMatchObject({ subscriptionId: nyDevice, userId: userIds.ally });

      // 17:00Z: Mom's turn.
      await scan("2026-10-02T17:00:00.000Z");
      const mom = (await inbox("mom", check.id))[0]!;
      expect(mom).toMatchObject({ title: "Health check • 12:05 PM", body: "Ally — Ally BP at 12:05 PM" });
      expect(mom.url).toContain("scheduledAt=2026-10-02T17%3A05%3A00.000Z");
    });

    it("two devices in one zone: both are reminded, the inbox keeps a single row", async () => {
      const check = await makeCheck();
      const phone = await addDevice("ally", "America/Chicago");
      const tablet = await addDevice("ally", "America/Chicago");
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(3); // two for Ally, one for Mom
      expect(await inbox("ally", check.id)).toHaveLength(1);
      const rows = await sentRows(check.id);
      expect(rows.filter((r) => r.userId === userIds.ally).map((r) => r.subscriptionId).sort()).toEqual([phone, tablet].sort());
      // And nothing is repeated.
      expect(await scan("2026-10-02T17:02:00.000Z")).toBe(0);
    });
  });

  describe("interval checks", () => {
    const grid = JSON.stringify({
      everyMinutes: 240,
      anchor: "fixed_start",
      fixedStartTime: "12:05",
      intervalFrom: "schedule_grid",
      stop: { mode: "midnight" },
    });

    it("reminds for the pending slot on the grid", async () => {
      const check = await makeCheck({ scheduleKind: "interval", scheduleJson: grid });
      expect(await scan("2026-10-02T17:00:00.000Z")).toBe(2);
      expect(await inbox("ally", check.id)).toHaveLength(1);
    });

    it("never reminds for the open-ended 'start' slot, which would otherwise repeat every scan", async () => {
      const startsAtFirstReading = JSON.stringify({
        everyMinutes: 240,
        anchor: "first_taken",
        intervalFrom: "last_taken",
        stop: { mode: "midnight" },
      });
      const check = await makeCheck({ scheduleKind: "interval", scheduleJson: startsAtFirstReading });
      for (const t of ["2026-10-02T17:00:00.000Z", "2026-10-02T17:05:00.000Z", "2026-10-02T17:10:00.000Z"]) {
        expect(await scan(t), t).toBe(0);
      }
      expect(await sentRows(check.id)).toHaveLength(0);
    });
  });
});
