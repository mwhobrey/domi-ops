import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, like } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthCheckGroupMembers,
  healthCheckGroupReminderSent,
  healthCheckGroups,
  healthCheckReminderSent,
  healthChecks,
  healthEvents,
  healthMemberAcl,
  healthVitalsReadings,
  householdMembers,
  households,
  userNotifications,
  users,
  withHouseholdContext,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import { scanHealthCheckReminders } from "./health-check-reminder-scan.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

// No VAPID keys: delivery only writes the inbox row, so nothing leaves the process.
const env = { ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" } as Env;
const BP = ["blood_pressure_systolic", "blood_pressure_diastolic"];

type CheckRow = typeof healthChecks.$inferSelect;

/**
 * WHO-387: consolidated reminders for check groups, against a real Postgres with an injected clock.
 * The household is on Chicago time; 2026-10-02 is a Friday in CDT (UTC-5), so a group at 12:05 local
 * is 17:05Z and `17:00Z` is "five minutes out".
 */
maybeDescribe("check group reminders (integration)", () => {
  let db: Database;
  let householdId: string;
  const userIds: Record<string, string> = {};
  const memberIds: Record<string, string> = {};

  const at = (iso: string) => new Date(iso);
  const SLOT = "2026-10-02T17:00:00.000Z"; // five minutes before the 12:05 group time

  async function scan(iso: string): Promise<number> {
    const count1 = () =>
      withWorkerScanContext(db, async (tx) => {
        const [a] = await tx
          .select({ n: count() })
          .from(healthCheckReminderSent)
          .innerJoin(healthChecks, eq(healthChecks.id, healthCheckReminderSent.checkId))
          .where(eq(healthChecks.householdId, householdId));
        const [b] = await tx
          .select({ n: count() })
          .from(healthCheckGroupReminderSent)
          .innerJoin(healthCheckGroups, eq(healthCheckGroups.id, healthCheckGroupReminderSent.groupId))
          .where(eq(healthCheckGroups.householdId, householdId));
        return a!.n + b!.n;
      });
    const before = await count1();
    await withHouseholdContext(db, householdId, (tx) => scanHealthCheckReminders(tx, env, { now: at(iso), householdId }));
    return (await count1()) - before;
  }

  async function seedPerson(key: string, name: string, role: "owner" | "member") {
    await withSystemContext(db, async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: `checkgroup-${key}-${randomUUID()}@test.local`,
          displayName: name,
          emailVerified: true,
          pushHealthRemindersEnabled: true,
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

  async function makeCheck(name: string, over: Partial<typeof healthChecks.$inferInsert> = {}): Promise<CheckRow> {
    const [row] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthChecks)
        .values({
          householdId,
          memberId: memberIds.ally!,
          name,
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

  const bpCheck = (over: Partial<typeof healthChecks.$inferInsert> = {}) => makeCheck("BP", over);
  const weightCheck = (over: Partial<typeof healthChecks.$inferInsert> = {}) =>
    makeCheck("Weight", { templateJson: JSON.stringify({ metrics: ["weight"] }), ...over });
  const painCheck = (over: Partial<typeof healthChecks.$inferInsert> = {}) =>
    makeCheck("Pain", { eventType: "pain", templateJson: "{}", ...over });

  async function makeGroup(members: CheckRow[], over: Partial<typeof healthCheckGroups.$inferInsert> = {}) {
    return withHouseholdContext(db, householdId, async (tx) => {
      const [group] = await tx
        .insert(healthCheckGroups)
        .values({
          householdId,
          memberId: memberIds.ally!,
          name: "Morning",
          scheduleJson: JSON.stringify({ times: ["12:05"] }),
          reminderOffsetsJson: "[0]",
          ...over,
        })
        .returning();
      for (const m of members) {
        await tx.insert(healthCheckGroupMembers).values({ groupId: group!.id, checkId: m.id, memberId: m.memberId });
      }
      return group!;
    });
  }

  async function makeEvent(iso: string, type: "vitals" | "pain", metrics: string[] = BP) {
    await withHouseholdContext(db, householdId, async (tx) => {
      const [ev] = await tx
        .insert(healthEvents)
        .values({ householdId, memberId: memberIds.ally!, type, title: "groupscan entry", startedAt: at(iso) })
        .returning({ id: healthEvents.id });
      if (type === "vitals") {
        for (const metric of metrics) {
          await tx.insert(healthVitalsReadings).values({ eventId: ev!.id, metric: metric as never, value: "1", unit: "x" });
        }
      }
    });
  }

  const notes = (userKey: string) =>
    withWorkerScanContext(db, (tx) =>
      tx.select().from(userNotifications).where(eq(userNotifications.userId, userIds[userKey]!)),
    );
  const groupNotes = async (userKey: string) =>
    (await notes(userKey)).filter((n) => (n.tag ?? "").startsWith("health-check-group-"));
  const checkNotes = async (userKey: string) =>
    (await notes(userKey)).filter((n) => (n.tag ?? "").startsWith("health-check-") && !(n.tag ?? "").startsWith("health-check-group-"));

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "checkgroup-it", timezone: "America/Chicago", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdId = hh.id;
    });
    await seedPerson("ally", "Ally", "member");
    await seedPerson("mom", "Mom", "owner");
    await withHouseholdContext(db, householdId, (tx) =>
      tx.insert(healthMemberAcl).values({
        householdId,
        subjectMemberId: memberIds.ally!,
        granteeMemberId: memberIds.mom!,
        eventsAccess: "write",
      }),
    );
  }, 30_000);

  beforeEach(async () => {
    if (!db) return;
    await withHouseholdContext(db, householdId, async (tx) => {
      await tx.delete(healthEvents).where(eq(healthEvents.householdId, householdId));
      await tx.delete(healthCheckGroups).where(eq(healthCheckGroups.householdId, householdId));
      await tx.delete(healthChecks).where(eq(healthChecks.householdId, householdId));
    });
    await withWorkerScanContext(db, (tx) =>
      tx.delete(userNotifications).where(eq(userNotifications.householdId, householdId)),
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

  describe("a scheduled group", () => {
    it("sends one reminder for the members at its time instead of one each", async () => {
      const group = await makeGroup([await bpCheck(), await weightCheck(), await painCheck()]);
      // Ally and the caregiver: one group reminder each, and none of the three individual ones.
      expect(await scan(SLOT)).toBe(2);

      const [ally] = await groupNotes("ally");
      expect(ally).toMatchObject({ title: "Morning • 12:05 PM", body: "Morning: BP, Pain, Weight at 12:05 PM" });
      expect(ally!.url).toBe(`/health?checkGroup=${group.id}&scheduledAt=2026-10-02T17%3A05%3A00.000Z`);
      const [mom] = await groupNotes("mom");
      expect(mom!.body).toBe("Ally — Morning: BP, Pain, Weight at 12:05 PM");
      expect(await groupNotes("ally")).toHaveLength(1);
      expect(await checkNotes("ally")).toHaveLength(0);
      expect(await checkNotes("mom")).toHaveLength(0);
    });

    it("sends it once, however often the scan runs", async () => {
      await makeGroup([await bpCheck(), await weightCheck()]);
      expect(await scan(SLOT)).toBe(2);
      expect(await scan("2026-10-02T17:02:00.000Z")).toBe(0);
      expect(await groupNotes("ally")).toHaveLength(1);
    });

    it("reminds only about the members still waiting when some are already answered", async () => {
      await makeGroup([await bpCheck(), await weightCheck(), await painCheck()]);
      await makeEvent("2026-10-02T17:03:00.000Z", "vitals", BP); // BP done a little early
      expect(await scan(SLOT)).toBe(2);
      expect((await groupNotes("ally"))[0]!.body).toBe("Morning: Pain, Weight at 12:05 PM");
    });

    it("stays quiet when every member is answered", async () => {
      await makeGroup([await bpCheck(), await painCheck()]);
      await makeEvent("2026-10-02T17:04:00.000Z", "vitals", BP);
      await makeEvent("2026-10-02T17:06:00.000Z", "pain");
      expect(await scan(SLOT)).toBe(0);
      expect(await notes("ally")).toHaveLength(0);
    });

    it("lists only the members that have a slot at the group's time, and leaves the others to their own", async () => {
      // Weight is on the group but its own times are 16:00, not 12:05.
      await makeGroup([await bpCheck(), await weightCheck({ scheduleJson: JSON.stringify({ times: ["16:00"] }) })]);
      expect(await scan(SLOT)).toBe(2);
      expect((await groupNotes("ally"))[0]!.body).toBe("Morning: BP at 12:05 PM");
      expect(await checkNotes("ally")).toHaveLength(0);

      // At 16:00 the group is silent (12:05 only) and Weight reminds on its own: the group did not claim 16:00.
      expect(await scan("2026-10-02T20:55:00.000Z")).toBe(2);
      expect(await groupNotes("ally")).toHaveLength(1);
      expect((await checkNotes("ally"))[0]!.body).toBe("Weight at 4:00 PM");
    });

    it("does not cover an interval member: its slots are not at the group's clock times, so it keeps its own", async () => {
      const grid = JSON.stringify({
        everyMinutes: 240,
        anchor: "fixed_start",
        fixedStartTime: "12:05",
        intervalFrom: "schedule_grid",
        stop: { mode: "midnight" },
      });
      // Its interval slot happens to land on 12:05 too; the group still does not list or claim it.
      await makeGroup([await bpCheck(), await weightCheck({ scheduleKind: "interval", scheduleJson: grid })]);
      expect(await scan(SLOT)).toBe(4);
      expect((await groupNotes("ally"))[0]!.body).toBe("Morning: BP at 12:05 PM");
      expect((await checkNotes("ally")).map((n) => n.body)).toEqual(["Weight at 12:05 PM"]);
    });

    it("nudges once, as the group, when it is still unanswered 30 minutes later", async () => {
      await makeGroup([await bpCheck(), await weightCheck()]);
      expect(await scan("2026-10-02T17:36:00.000Z")).toBe(2);
      const [nudge] = await groupNotes("ally");
      expect(nudge).toMatchObject({ title: "Morning overdue • 12:05 PM" });
      expect(nudge!.body).toBe("Morning: BP, Weight at 12:05 PM hasn't been logged yet");
      expect(await scan("2026-10-02T17:40:00.000Z")).toBe(0);
    });

    it("drops a paused member out of the group's reminder, and does not remind for it on its own", async () => {
      const bp = await bpCheck();
      const weight = await weightCheck();
      await makeGroup([bp, weight]);
      await withHouseholdContext(db, householdId, (tx) =>
        tx.update(healthChecks).set({ enabled: false }).where(eq(healthChecks.id, weight.id)),
      );
      expect(await scan(SLOT)).toBe(2);
      expect((await groupNotes("ally"))[0]!.body).toBe("Morning: BP at 12:05 PM");
      expect(await checkNotes("ally")).toHaveLength(0);
    });

    it("sends nothing when every member is paused", async () => {
      const bp = await bpCheck();
      await makeGroup([bp]);
      await withHouseholdContext(db, householdId, (tx) =>
        tx.update(healthChecks).set({ enabled: false }).where(eq(healthChecks.id, bp.id)),
      );
      expect(await scan(SLOT)).toBe(0);
    });

    it("a paused group hands its members back to their own reminders", async () => {
      await makeGroup([await bpCheck(), await weightCheck()], { enabled: false });
      expect(await scan(SLOT)).toBe(4); // two checks, two recipients
      expect(await groupNotes("ally")).toHaveLength(0);
      expect(await checkNotes("ally")).toHaveLength(2);
    });

    it("only claims the days the group runs: on its off days the members remind individually", async () => {
      // 2026-10-02 is a Friday (5); the group runs Mondays only.
      await makeGroup([await bpCheck()], { scheduleJson: JSON.stringify({ times: ["12:05"], daysOfWeek: [1] }) });
      expect(await scan(SLOT)).toBe(2);
      expect(await groupNotes("ally")).toHaveLength(0);
      expect(await checkNotes("ally")).toHaveLength(1);
    });

    it("a check in two groups is covered by whichever group has the slot", async () => {
      const bp = await bpCheck({ scheduleJson: JSON.stringify({ times: ["12:05", "16:00"] }) });
      await makeGroup([bp], { name: "Midday", scheduleJson: JSON.stringify({ times: ["12:05"] }) });
      await makeGroup([bp], { name: "Afternoon", scheduleJson: JSON.stringify({ times: ["16:00"] }) });
      expect(await scan(SLOT)).toBe(2);
      expect((await groupNotes("ally"))[0]!.title).toBe("Midday • 12:05 PM");
      expect(await scan("2026-10-02T20:55:00.000Z")).toBe(2);
      expect((await groupNotes("ally")).map((n) => n.title).sort()).toEqual(["Afternoon • 4:00 PM", "Midday • 12:05 PM"]);
      expect(await checkNotes("ally")).toHaveLength(0);
    });

    it("honours the group's own offsets", async () => {
      await makeGroup([await bpCheck()], { reminderOffsetsJson: "[15]" });
      expect(await scan("2026-10-02T16:50:00.000Z")).toBe(2); // 15 minutes before 17:05
      const rows = await withWorkerScanContext(db, (tx) => tx.select().from(healthCheckGroupReminderSent));
      expect(rows.some((r) => r.offsetMinutes === 15)).toBe(true);
    });
  });

  describe("an interval group", () => {
    const grid = JSON.stringify({
      everyMinutes: 240,
      anchor: "fixed_start",
      fixedStartTime: "12:05",
      intervalFrom: "schedule_grid",
      stop: { mode: "midnight" },
    });

    it("reminds for its own pending slot, and its interval members delegate their whole schedule to it", async () => {
      const a = await bpCheck({ scheduleKind: "interval", scheduleJson: grid });
      const b = await weightCheck({ scheduleKind: "interval", scheduleJson: grid });
      await makeGroup([a, b], { scheduleKind: "interval", scheduleJson: grid });
      expect(await scan(SLOT)).toBe(2);
      expect((await groupNotes("ally"))[0]!.body).toBe("Morning: BP, Weight at 12:05 PM");
      expect(await checkNotes("ally")).toHaveLength(0);
    });

    it.each([
      ["ended", { endDate: "2026-10-01" }],
      ["not started", { startDate: "2026-10-03" }],
    ])("while %s it takes nothing over, so its members remind on their own", async (_label, dates) => {
      const a = await bpCheck({ scheduleKind: "interval", scheduleJson: grid });
      await makeGroup([a], { scheduleKind: "interval", scheduleJson: grid, ...dates });
      expect(await scan(SLOT)).toBe(2);
      expect(await groupNotes("ally")).toHaveLength(0);
      expect(await checkNotes("ally")).toHaveLength(1);
    });

    it("an interval group that can't be read does not swallow its members' reminders", async () => {
      const a = await bpCheck({ scheduleKind: "interval", scheduleJson: grid });
      await makeGroup([a], { scheduleKind: "interval", scheduleJson: "{}" });
      expect(await scan(SLOT)).toBe(2);
      expect(await groupNotes("ally")).toHaveLength(0);
      expect(await checkNotes("ally")).toHaveLength(1);
    });
  });

  describe("an interval of several days", () => {
    // Every 2 days from the last reading. The last reading is two days back, older than the
    // yesterday..tomorrow the scan looks at, but it is what the next slot counts from.
    const everyTwoDays = JSON.stringify({
      everyMinutes: 2 * 24 * 60,
      anchor: "first_taken",
      intervalFrom: "last_taken",
      stop: { mode: "midnight" },
    });

    it("a check still reminds, counting from a reading older than the days looked at", async () => {
      await makeEvent("2026-09-30T17:05:00.000Z", "vitals", BP);
      await bpCheck({ scheduleKind: "interval", scheduleJson: everyTwoDays });
      expect(await scan(SLOT)).toBe(2);
      expect((await checkNotes("ally"))[0]!.body).toBe("BP at 12:05 PM");
    });

    it("a group counts from it too, even when its members are not interval checks themselves", async () => {
      await makeEvent("2026-09-30T17:05:00.000Z", "vitals", ["weight"]);
      // Scheduled members at another time of day, so they have no say in the group's clock window.
      const bp = await bpCheck({ scheduleJson: JSON.stringify({ times: ["09:00"] }) });
      const weight = await weightCheck({ scheduleJson: JSON.stringify({ times: ["09:00"] }) });
      await makeGroup([bp, weight], { scheduleKind: "interval", scheduleJson: everyTwoDays });
      await scan(SLOT);
      expect((await groupNotes("ally")).map((n) => n.body)).toEqual(["Morning: BP, Weight at 12:05 PM"]);
    });
  });

  it("does not look at a group or check from another household", async () => {
    // The scan is scoped to one household, and a group only ever lists its own members.
    const other = await withSystemContext(db, async (tx) => {
      const [h] = await tx
        .insert(households)
        .values({ name: "checkgroup-other", timezone: "America/Chicago", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      return h!.id;
    });
    try {
      await makeGroup([await bpCheck()]);
      expect(await scan(SLOT)).toBe(2);
      const rows = await withWorkerScanContext(db, (tx) =>
        tx
          .select({ n: count() })
          .from(userNotifications)
          .where(and(eq(userNotifications.householdId, other), like(userNotifications.tag, "health-check-%"))),
      );
      expect(rows[0]!.n).toBe(0);
    } finally {
      await withSystemContext(db, (tx) => tx.delete(households).where(eq(households.id, other)));
    }
  });
});
