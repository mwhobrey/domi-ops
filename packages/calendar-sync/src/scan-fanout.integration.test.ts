import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  calendarEventReminders,
  calendarEvents,
  calendars,
  chores,
  closeDb,
  createDb,
  expenseBudgets,
  householdMembers,
  households,
  schoolClasses,
  userNotifications,
  users,
  withHouseholdContext,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import { scanBudgetAlerts } from "./budget-alert-scan.js";
import { scanChoreDigest } from "./chore-digest-scan.js";
import { scanChoreReminders } from "./chore-reminder-scan.js";
import { scanCalendarReminders } from "./reminder-scan.js";
import { scanSchoolReminders } from "./school-reminder-scan.js";
import { scanDriveQuotaWarnings } from "./drive-quota-scan.js";
import type { EnqueueHouseholdScan, HouseholdScanJob } from "./household-scan-fanout.js";
import {
  fanOutBudgetAlertScans,
  fanOutCalendarReminderScans,
  fanOutChoreDigestScans,
  fanOutChoreReminderScans,
  fanOutDriveQuotaScans,
  fanOutSchoolReminderScans,
} from "./scan-fanout.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

// No VAPID keys: delivery only writes the inbox row, so nothing leaves the process.
const env = { ENCRYPTION_KEY: "test-health-encryption-key-32chars!!", DRIVE_QUOTA_WARN_PERCENT: 80 } as Env;

type Fan = (db: Database, deps: { enqueue: EnqueueHouseholdScan }) => Promise<number>;

/**
 * The tick side of the per-household scans (WHO-404). Other suites share the database, so every
 * assertion looks only at the households this suite created. Each household has exactly one kind
 * of work (or a decoy that must not count), so the set of ids enqueued says which rule picked it.
 */
maybeDescribe("per-household scan fan-out (integration)", () => {
  let db: Database;
  const hh: Record<string, string> = {};
  const userIds: string[] = [];
  const memberIds: Record<string, string> = {};

  async function seed(key: string, over: Partial<typeof households.$inferInsert> = {}) {
    await withSystemContext(db, async (tx) => {
      const [h] = await tx
        .insert(households)
        .values({ name: `scanfan-${key}`, timezone: "UTC", ...over })
        .returning({ id: households.id });
      hh[key] = h.id;
      const [u] = await tx
        .insert(users)
        .values({ email: `scanfan-${key}-${randomUUID()}@test.local`, displayName: key, emailVerified: true })
        .returning({ id: users.id });
      userIds.push(u.id);
      const [m] = await tx
        .insert(householdMembers)
        .values({ householdId: h.id, userId: u.id, role: "owner", name: key })
        .returning({ id: householdMembers.id });
      memberIds[key] = m.id;
    });
  }

  const inHousehold = <T>(key: string, fn: (tx: Database) => Promise<T>) => withHouseholdContext(db, hh[key]!, fn);

  async function addReminder(key: string, over: { enabled?: boolean; lastSentAt?: Date | null } = {}) {
    await inHousehold(key, async (tx) => {
      const [cal] = await tx
        .insert(calendars)
        .values({ householdId: hh[key]!, name: "Cal", visibility: "household" })
        .returning({ id: calendars.id });
      const [ev] = await tx
        .insert(calendarEvents)
        .values({ householdId: hh[key]!, calendarId: cal.id, title: "Event", startDate: "2030-01-01" })
        .returning({ id: calendarEvents.id });
      await tx
        .insert(calendarEventReminders)
        .values({ eventId: ev.id, householdId: hh[key]!, offsetMinutes: 10, ...over });
    });
  }

  const addChore = (key: string, over: Partial<typeof chores.$inferInsert> = {}) =>
    inHousehold(key, (tx) =>
      tx.insert(chores).values({ householdId: hh[key]!, description: "Take out trash", ...over }),
    );

  async function enqueuedBy(fan: Fan): Promise<{ ids: string[]; job: HouseholdScanJob | undefined }> {
    const calls: { job: HouseholdScanJob; householdId: string }[] = [];
    const enqueue: EnqueueHouseholdScan = async (job, householdId) => {
      calls.push({ job, householdId });
    };
    await withWorkerScanContext(db, (tx) => fan(tx, { enqueue }));
    const mine = calls.filter((c) => Object.values(hh).includes(c.householdId));
    return { ids: mine.map((c) => c.householdId).sort(), job: mine[0]?.job };
  }

  const idsOf = (...keys: string[]) => keys.map((k) => hh[k]!).sort();

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    for (const key of [
      "cal", "calSent", "calOff",
      "chore", "choreDone", "choreUndated",
      "budget", "school", "schoolArchived", "drive", "empty",
    ]) {
      await seed(key);
    }
    await addReminder("cal");
    await addReminder("calSent", { lastSentAt: new Date() });
    await addReminder("calOff", { enabled: false });

    await addChore("chore", { dueDate: "2030-01-01" });
    await addChore("choreDone", { dueDate: "2030-01-01", done: true });
    await addChore("choreUndated");

    await inHousehold("budget", (tx) =>
      tx.insert(expenseBudgets).values({ householdId: hh.budget!, category: "Food", monthlyTarget: 100 }),
    );
    await inHousehold("school", (tx) =>
      tx.insert(schoolClasses).values({ householdId: hh.school!, name: "Math", teacherMemberId: memberIds.school! }),
    );
    await inHousehold("schoolArchived", (tx) =>
      tx.insert(schoolClasses).values({
        householdId: hh.schoolArchived!,
        name: "Old",
        teacherMemberId: memberIds.schoolArchived!,
        archived: true,
      }),
    );
    await withSystemContext(db, (tx) =>
      tx.update(households).set({ storageQuotaBytes: 1000, storageUsedBytes: 990 }).where(eq(households.id, hh.drive!)),
    );
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      const ids = Object.values(hh);
      if (ids.length) await tx.delete(households).where(inArray(households.id, ids));
      if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
    });
    await closeDb(db);
  });

  it("calendar: only households with an enabled reminder that has not been sent", async () => {
    const { ids, job } = await enqueuedBy(fanOutCalendarReminderScans);
    expect(ids).toEqual(idsOf("cal"));
    expect(job).toBe("calendar.reminder.household");
  });

  it("chore reminders: only households with an open chore that has a due date", async () => {
    const { ids, job } = await enqueuedBy(fanOutChoreReminderScans);
    expect(ids).toEqual(idsOf("chore"));
    expect(job).toBe("chore.reminder.household");
  });

  it("chore digest: same households, its own job", async () => {
    const { ids, job } = await enqueuedBy(fanOutChoreDigestScans);
    expect(ids).toEqual(idsOf("chore"));
    expect(job).toBe("chore.digest.household");
  });

  it("budget alerts: only households with a budget", async () => {
    const { ids, job } = await enqueuedBy(fanOutBudgetAlertScans);
    expect(ids).toEqual(idsOf("budget"));
    expect(job).toBe("expense.budget.household");
  });

  it("school: only households with an unarchived class", async () => {
    const { ids, job } = await enqueuedBy(fanOutSchoolReminderScans);
    expect(ids).toEqual(idsOf("school"));
    expect(job).toBe("school.reminder.household");
  });

  it("drive quota: only households that have a quota", async () => {
    const { ids, job } = await enqueuedBy(fanOutDriveQuotaScans);
    expect(ids).toEqual(idsOf("drive"));
    expect(job).toBe("drive.quota.household");
  });

  describe("a household job only touches its own household", () => {
    const sentAt = (key: string) =>
      inHousehold(key, async (tx) => {
        const [row] = await tx.select({ at: chores.dueReminderSentAt }).from(chores).where(eq(chores.householdId, hh[key]!));
        return row!.at;
      });

    it("chore reminders", async () => {
      // Overdue in both households; scanning one must leave the other unreminded.
      await addChore("empty", { dueDate: "2020-01-01" });
      await addChore("chore", { dueDate: "2020-01-01" });
      // Cross-tenant on purpose: with RLS confining the run to one household the filter would be
      // invisible, but self-hosted installs connect as a superuser where only the filter scopes it.
      const sent = await withWorkerScanContext(db, (tx) => scanChoreReminders(tx, env, { householdId: hh.chore }));
      expect(sent).toBeGreaterThanOrEqual(1);
      expect(await sentAt("empty")).toBeNull();
      await inHousehold("empty", (tx) => tx.delete(chores).where(eq(chores.householdId, hh.empty!)));
    });

    it("drive quota", async () => {
      await withSystemContext(db, (tx) =>
        tx.update(households).set({ storageQuotaBytes: 1000, storageUsedBytes: 990 }).where(eq(households.id, hh.empty!)),
      );
      const sent = await withWorkerScanContext(db, (tx) =>
        scanDriveQuotaWarnings(tx, env, { householdId: hh.drive }),
      );
      expect(sent).toBe(1);
      const [other] = await withHouseholdContext(db, hh.empty!, (tx) =>
        tx.select({ at: households.driveQuotaWarnSentAt }).from(households).where(eq(households.id, hh.empty!)),
      );
      expect(other!.at).toBeNull();
    });
  });

  // The jobs run as the worker runs them: inside the household's own context, as the non-superuser
  // role on hosted. This is what would have shown a table the scan reads but the household context
  // can't (WHO-403 was exactly that, in the other direction, and nothing failed loudly).
  describe("each scan works inside the household's own context", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const inboxTags = (key: string, prefix: string) =>
      inHousehold(key, async (tx) => {
        const rows = await tx.select({ tag: userNotifications.tag }).from(userNotifications);
        return rows.map((r) => r.tag ?? "").filter((t) => t.startsWith(prefix));
      });

    function pinNoonUtc() {
      const noon = new Date();
      noon.setUTCHours(12, 0, 0, 0);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(noon);
      return noon.toISOString().slice(0, 10);
    }

    it("calendar reminders deliver to the household", async () => {
      const today = pinNoonUtc();
      await inHousehold("empty", async (tx) => {
        const [cal] = await tx
          .insert(calendars)
          .values({ householdId: hh.empty!, name: "Run", visibility: "household" })
          .returning({ id: calendars.id });
        const [ev] = await tx
          .insert(calendarEvents)
          .values({ householdId: hh.empty!, calendarId: cal.id, title: "Run event", startDate: today, startTime: "12:05:00" })
          .returning({ id: calendarEvents.id });
        await tx.insert(calendarEventReminders).values({ eventId: ev.id, householdId: hh.empty!, offsetMinutes: 5 });
      });
      const sent = await inHousehold("empty", (tx) => scanCalendarReminders(tx, env, { householdId: hh.empty }));
      expect(sent).toBe(1);
      expect(await inboxTags("empty", "calendar-")).toHaveLength(1);
    });

    it("the chore digest delivers to the household", async () => {
      const today = pinNoonUtc();
      await addChore("chore", { dueDate: today, description: "Digest chore" });
      const sent = await inHousehold("chore", (tx) => scanChoreDigest(tx, env, { householdId: hh.chore }));
      expect(sent).toBe(1);
      expect(await inboxTags("chore", "chore-digest-")).toHaveLength(1);
    });

    it("the school and budget scans run without error", async () => {
      pinNoonUtc();
      await inHousehold("school", (tx) => scanSchoolReminders(tx, env, { householdId: hh.school }));
      await inHousehold("budget", (tx) => scanBudgetAlerts(tx, env, { householdId: hh.budget }));
    });
  });
});
