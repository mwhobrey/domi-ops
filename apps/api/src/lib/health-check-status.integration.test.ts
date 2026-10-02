import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthCheckLogs,
  healthCheckPauses,
  healthChecks,
  healthEvents,
  healthVitalsReadings,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import { loadCheckSlotStatuses } from "./health-check-status.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = { ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" } as Env;
const at = (iso: string) => new Date(iso);
type CheckRow = typeof healthChecks.$inferSelect;

/**
 * WHO-384: the loader that feeds the pure slot logic with real rows (logs, nearby entries, the
 * vitals metrics they hold, pauses) against a real Postgres. The pure rules are unit tested in
 * calendar-sync; this proves the queries gather the right rows, including the window edges.
 */
maybeDescribe("loadCheckSlotStatuses (integration)", () => {
  let db: Database;
  let householdId: string;
  let userId: string;
  let memberId: string;
  let otherMemberId: string;

  const BP_METRICS = ["blood_pressure_systolic", "blood_pressure_diastolic"] as const;

  async function makeCheck(over: Partial<typeof healthChecks.$inferInsert> = {}): Promise<CheckRow> {
    const [row] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthChecks)
        .values({
          householdId,
          memberId,
          name: "BP",
          eventType: "vitals",
          // Plain JSON is read back as-is (the loader tolerates unencrypted rows).
          templateJson: JSON.stringify({ metrics: [...BP_METRICS] }),
          scheduleJson: JSON.stringify({ times: ["08:00", "12:00", "16:00", "20:00"] }),
          ...over,
        })
        .returning(),
    );
    return row!;
  }

  async function makeEvent(
    iso: string | null,
    over: { type?: "vitals" | "pain"; memberId?: string; metrics?: readonly string[] } = {},
  ): Promise<string> {
    const [row] = await withHouseholdContext(db, householdId, async (tx) => {
      const [ev] = await tx
        .insert(healthEvents)
        .values({
          householdId,
          memberId: over.memberId ?? memberId,
          type: over.type ?? "vitals",
          title: "who384",
          startedAt: iso ? at(iso) : null,
        })
        .returning({ id: healthEvents.id });
      const metrics = over.metrics ?? (over.type === "pain" ? [] : BP_METRICS);
      for (const metric of metrics) {
        await tx.insert(healthVitalsReadings).values({ eventId: ev!.id, metric: metric as never, value: "1", unit: "x" });
      }
      return [ev!];
    });
    return row!.id;
  }

  const load = async (check: CheckRow, from: string, to: string, now: string, timeZone = "UTC") => {
    const map = await withHouseholdContext(db, householdId, (tx) =>
      loadCheckSlotStatuses(tx, env, { checks: [check], from, to, timeZone, now: at(now) }),
    );
    return map.get(check.id)!;
  };
  const summary = (r: Awaited<ReturnType<typeof load>>) => r.map((s) => `${s.scheduledAt.toISOString().slice(11, 16)} ${s.status}`);

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx.insert(households).values({ name: "slotstatus-it", timezone: "UTC" }).returning({ id: households.id });
      householdId = hh.id;
      const [u] = await tx
        .insert(users)
        .values({ email: `slotstatus-it-${randomUUID()}@test.local`, displayName: "slotstatus", emailVerified: true })
        .returning({ id: users.id });
      userId = u.id;
      const [m] = await tx.insert(householdMembers).values({ householdId, userId, role: "owner", name: "Ally" }).returning({ id: householdMembers.id });
      memberId = m.id;
      const [u2] = await tx
        .insert(users)
        .values({ email: `slotstatus-it2-${randomUUID()}@test.local`, displayName: "other", emailVerified: true })
        .returning({ id: users.id });
      const [m2] = await tx.insert(householdMembers).values({ householdId, userId: u2.id, role: "member", name: "Other" }).returning({ id: householdMembers.id });
      otherMemberId = m2.id;
    });
  }, 30_000);

  // Entries are the point of these tests, so each test starts with none: a reading left over from
  // one test would complete a slot in the next.
  beforeEach(async () => {
    if (!db) return;
    await withHouseholdContext(db, householdId, async (tx) => {
      await tx.delete(healthEvents).where(eq(healthEvents.householdId, householdId));
      await tx.delete(healthChecks).where(eq(healthChecks.householdId, householdId));
    });
  });

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      if (userId) await tx.delete(users).where(eq(users.id, userId));
    });
    await closeDb(db);
  });

  describe("scheduled checks", () => {
    it("reports upcoming, due and overdue by the clock when nothing was logged", async () => {
      const check = await makeCheck();
      const r = await load(check, "2026-10-02", "2026-10-02", "2026-10-02T12:10:00.000Z");
      expect(summary(r)).toEqual(["08:00 overdue", "12:00 due", "16:00 upcoming", "20:00 upcoming"]);
    });

    it("an unlinked reading near a slot completes it, with its metrics checked", async () => {
      const check = await makeCheck();
      await makeEvent("2026-10-02T12:10:00.000Z"); // a real BP reading
      await makeEvent("2026-10-02T16:05:00.000Z", { metrics: ["weight"] }); // weight only: not a BP
      await makeEvent("2026-10-02T20:00:00.000Z", { type: "pain" }); // the wrong kind of entry
      await makeEvent("2026-10-02T08:00:00.000Z", { memberId: otherMemberId }); // someone else
      const r = await load(check, "2026-10-02", "2026-10-02", "2026-10-03T00:00:00.000Z");
      expect(summary(r)).toEqual(["08:00 overdue", "12:00 done", "16:00 overdue", "20:00 overdue"]);
      expect(r[1]!.source).toBe("event");
    });

    it("an explicit log wins, and a linked far-off reading counts and is not reused", async () => {
      const check = await makeCheck();
      const yesterdayReading = await makeEvent("2026-10-01T07:41:00.000Z");
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthCheckLogs).values([
          { checkId: check.id, scheduledAt: at("2026-10-02T12:00:00.000Z"), status: "done", healthEventId: yesterdayReading },
          { checkId: check.id, scheduledAt: at("2026-10-02T16:00:00.000Z"), status: "skipped" },
        ]),
      );
      // A reading right at 16:00 would complete that slot, but it was deliberately skipped.
      await makeEvent("2026-10-02T16:02:00.000Z");
      const r = await load(check, "2026-10-02", "2026-10-02", "2026-10-03T00:00:00.000Z");
      expect(summary(r)).toEqual(["08:00 overdue", "12:00 done", "16:00 skipped", "20:00 overdue"]);
      expect(r[1]).toMatchObject({ source: "log", eventId: yesterdayReading });
    });

    it("sees a reading just before the first day (the tolerance window reaches past the range)", async () => {
      const check = await makeCheck({ scheduleJson: JSON.stringify({ times: ["00:05"] }) });
      await makeEvent("2026-10-01T23:50:00.000Z"); // 15 minutes before the slot, on the previous day
      const r = await load(check, "2026-10-02", "2026-10-02", "2026-10-03T00:00:00.000Z");
      expect(summary(r)).toEqual(["00:05 done"]);
    });

    it("an entry linked to a slot outside the range is still spoken for", async () => {
      const check = await makeCheck({ scheduleJson: JSON.stringify({ times: ["12:00"] }) });
      const reading = await makeEvent("2026-10-02T12:05:00.000Z");
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthCheckLogs).values({ checkId: check.id, scheduledAt: at("2026-10-09T12:00:00.000Z"), status: "done", healthEventId: reading }),
      );
      const r = await load(check, "2026-10-02", "2026-10-02", "2026-10-03T00:00:00.000Z");
      expect(summary(r)).toEqual(["12:00 overdue"]);
    });

    it("drops slots inside a pause and after deletion", async () => {
      const paused = await makeCheck({ scheduleJson: JSON.stringify({ times: ["08:00", "20:00"] }) });
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthCheckPauses).values({ checkId: paused.id, pausedAt: at("2026-10-02T00:00:00.000Z"), resumedAt: at("2026-10-02T12:00:00.000Z") }),
      );
      expect(summary(await load(paused, "2026-10-02", "2026-10-02", "2026-10-03T00:00:00.000Z"))).toEqual(["20:00 overdue"]);

      const deleted = await makeCheck({ scheduleJson: JSON.stringify({ times: ["08:00", "20:00"] }), deletedAt: at("2026-10-02T10:00:00.000Z"), enabled: false });
      expect(summary(await load(deleted, "2026-10-02", "2026-10-02", "2026-10-03T00:00:00.000Z"))).toEqual(["08:00 overdue"]);

      const stillPaused = await makeCheck({ scheduleJson: JSON.stringify({ times: ["08:00"] }) });
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthCheckPauses).values({ checkId: stillPaused.id, pausedAt: at("2026-09-01T00:00:00.000Z") }),
      );
      expect(await load(stillPaused, "2026-10-02", "2026-10-02", "2026-10-03T00:00:00.000Z")).toEqual([]);
    });

    it("honours the start / end dates and the weekday filter", async () => {
      const check = await makeCheck({
        scheduleJson: JSON.stringify({ times: ["09:00"], daysOfWeek: [5] }), // Fridays
        startDate: "2026-10-02",
        endDate: "2026-10-09",
      });
      const r = await load(check, "2026-09-28", "2026-10-16", "2026-10-30T00:00:00.000Z");
      expect(r.map((s) => s.scheduledAt.toISOString())).toEqual(["2026-10-02T09:00:00.000Z", "2026-10-09T09:00:00.000Z"]);
    });
  });

  describe("time zones", () => {
    it("lays slots out in the zone asked for, and matches readings against those instants", async () => {
      const check = await makeCheck({ scheduleJson: JSON.stringify({ times: ["08:00"] }) });
      await makeEvent("2026-10-02T13:05:00.000Z"); // 08:05 in Chicago (CDT, UTC-5), 09:05 in New York
      const now = "2026-10-03T00:00:00.000Z";
      const chicago = await load(check, "2026-10-02", "2026-10-02", now, "America/Chicago");
      expect(chicago.map((s) => [s.scheduledAt.toISOString(), s.status])).toEqual([["2026-10-02T13:00:00.000Z", "done"]]);
      const newYork = await load(check, "2026-10-02", "2026-10-02", now, "America/New_York");
      expect(newYork.map((s) => [s.scheduledAt.toISOString(), s.status])).toEqual([["2026-10-02T12:00:00.000Z", "overdue"]]);
    });
  });

  describe("interval checks", () => {
    const grid = JSON.stringify({
      everyMinutes: 240,
      anchor: "fixed_start",
      fixedStartTime: "08:00",
      intervalFrom: "schedule_grid",
      stop: { mode: "midnight" },
    });

    it("offers the next slot on the grid and keeps answered ones", async () => {
      const check = await makeCheck({ scheduleKind: "interval", scheduleJson: grid });
      expect(summary(await load(check, "2026-10-02", "2026-10-02", "2026-10-02T09:00:00.000Z"))).toEqual(["08:00 overdue"]);

      // Completing the 08:00 slot (the reading was taken at 08:10) moves the grid on to 12:00. The
      // interval engine advances from doses that were taken, exactly as it does for medications.
      const reading = await makeEvent("2026-10-02T08:10:00.000Z");
      await withHouseholdContext(db, householdId, (tx) =>
        tx.insert(healthCheckLogs).values({ checkId: check.id, scheduledAt: at("2026-10-02T08:00:00.000Z"), status: "done", healthEventId: reading }),
      );
      const after = await load(check, "2026-10-02", "2026-10-02", "2026-10-02T09:00:00.000Z");
      expect(summary(after)).toEqual(["08:00 done", "12:00 upcoming"]);
    });

    it("an unlinked reading completes the pending interval slot", async () => {
      const check = await makeCheck({ scheduleKind: "interval", scheduleJson: grid });
      await makeEvent("2026-10-02T08:10:00.000Z");
      const r = await load(check, "2026-10-02", "2026-10-02", "2026-10-02T09:00:00.000Z");
      // The 08:00 slot is done by the reading, and the engine moves on to 12:00.
      expect(r.map((s) => s.status)).toContain("done");
    });

    it("a malformed interval schedule yields no slots instead of an error", async () => {
      const check = await makeCheck({ scheduleKind: "interval", scheduleJson: "{}" });
      expect(await load(check, "2026-10-02", "2026-10-02", "2026-10-02T09:00:00.000Z")).toEqual([]);
    });
  });
});
