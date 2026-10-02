import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  healthCheckLogs,
  healthChecks,
  healthEvents,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import {
  RecordCheckError,
  deleteCheckLog,
  editCheckLog,
  normalizeSlotInstant,
  recordCheck,
  unlinkCheckLogsForEvent,
  type EditCheckLogInput,
  type RecordCheckErrorCode,
  type RecordCheckInput,
} from "./health-check-logging.js";

const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = { ENCRYPTION_KEY: "test-health-encryption-key-32chars!!" } as Env;
const noon = new Date("2026-10-02T12:00:00.000Z");
const four = new Date("2026-10-02T16:00:00.000Z");

describe("normalizeSlotInstant", () => {
  it("truncates seconds and milliseconds so a slot is never a second apart from itself", () => {
    expect(normalizeSlotInstant(new Date("2026-10-02T12:00:07.123Z")).toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(normalizeSlotInstant(new Date("2026-10-02T12:00:59.999Z")).toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(normalizeSlotInstant(new Date("2026-10-02T12:00:00.000Z")).toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(normalizeSlotInstant(new Date("2026-10-02T12:01:00.000Z")).toISOString()).toBe("2026-10-02T12:01:00.000Z");
  });
});

/**
 * WHO-383: the one-writer / one-conflict-rule contract of recordCheck against a real Postgres with
 * the `health_check_logs_instant_unique` index in place (migration 0085). Runs in `test:hosted`;
 * skipped without a database.
 */
maybeDescribe("recordCheck (integration)", () => {
  let db: Database;
  let householdId: string;
  let userId: string;
  let memberId: string;
  let otherMemberId: string;
  let bp: typeof healthChecks.$inferSelect;
  let weight: typeof healthChecks.$inferSelect;
  const events: Record<string, string> = {};

  const run = (input: Partial<RecordCheckInput> & Pick<RecordCheckInput, "status" | "source">) =>
    withHouseholdContext(db, householdId, (tx) =>
      recordCheck(tx, env, {
        check: bp,
        loggedByUserId: userId,
        scheduledAt: noon,
        loggedAt: new Date(),
        ...input,
      }),
    );

  const codeOf = async (p: Promise<unknown>): Promise<RecordCheckErrorCode | "no error"> => {
    try {
      await p;
      return "no error";
    } catch (e) {
      if (e instanceof RecordCheckError) return e.code;
      throw e;
    }
  };

  const logsFor = (checkId: string) =>
    withHouseholdContext(db, householdId, (tx) =>
      tx.select().from(healthCheckLogs).where(eq(healthCheckLogs.checkId, checkId)),
    );

  const clear = () =>
    withHouseholdContext(db, householdId, async (tx) => {
      await tx.delete(healthCheckLogs).where(eq(healthCheckLogs.checkId, bp.id));
      await tx.delete(healthCheckLogs).where(eq(healthCheckLogs.checkId, weight.id));
    });

  async function makeEvent(key: string, memberOf: string, type: "vitals" | "pain", startedAt = noon) {
    const [row] = await withHouseholdContext(db, householdId, (tx) =>
      tx
        .insert(healthEvents)
        .values({ householdId, memberId: memberOf, type, title: `who383-${key}`, startedAt })
        .returning({ id: healthEvents.id }),
    );
    events[key] = row!.id;
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    db = createDb(TEST_URL);
    await withSystemContext(db, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name: "recordCheck-it", timezone: "UTC" })
        .returning({ id: households.id });
      householdId = hh.id;
      const [u] = await tx
        .insert(users)
        .values({ email: `recordcheck-it-${randomUUID()}@test.local`, displayName: "recordCheck-it", emailVerified: true })
        .returning({ id: users.id });
      userId = u.id;
      const [m] = await tx
        .insert(householdMembers)
        .values({ householdId, userId, role: "owner", name: "Tester" })
        .returning({ id: householdMembers.id });
      memberId = m.id;
      const [u2] = await tx
        .insert(users)
        .values({ email: `recordcheck-it2-${randomUUID()}@test.local`, displayName: "Other", emailVerified: true })
        .returning({ id: users.id });
      const [m2] = await tx
        .insert(householdMembers)
        .values({ householdId, userId: u2.id, role: "member", name: "Other" })
        .returning({ id: householdMembers.id });
      otherMemberId = m2.id;
    });
    await withHouseholdContext(db, householdId, async (tx) => {
      const [a] = await tx
        .insert(healthChecks)
        .values({ householdId, memberId, name: "BP", eventType: "vitals" })
        .returning();
      bp = a!;
      const [b] = await tx
        .insert(healthChecks)
        .values({ householdId, memberId, name: "Weight", eventType: "vitals" })
        .returning();
      weight = b!;
    });
    await makeEvent("vitals1", memberId, "vitals");
    await makeEvent("vitals2", memberId, "vitals");
    await makeEvent("pain", memberId, "pain");
    await makeEvent("otherMember", otherMemberId, "vitals");
    // Logged a whole day before the slot: how early or late it is must not matter.
    await makeEvent("yesterday", memberId, "vitals", new Date("2026-10-01T09:13:00.000Z"));
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => {
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
      if (userId) await tx.delete(users).where(eq(users.id, userId));
    });
    await closeDb(db);
  });

  describe("completing a slot", () => {
    it("links the event and stores the log", async () => {
      await clear();
      const { log, outcome } = await run({ status: "done", source: "single", healthEventId: events.vitals1, notes: "felt fine" });
      expect(outcome).toBe("inserted");
      expect(log).toMatchObject({
        checkId: bp.id,
        scheduledAt: noon.toISOString(),
        status: "done",
        healthEventId: events.vitals1,
        notes: "felt fine",
        loggedByUserId: userId,
      });
      const [row] = await logsFor(bp.id);
      expect(row!.notes!.startsWith("enc:v1:")).toBe(true);
    });

    it("counts however early or late the event is", async () => {
      await clear();
      const { log } = await run({ status: "done", source: "single", healthEventId: events.yesterday });
      expect(log.status).toBe("done");
      expect(log.healthEventId).toBe(events.yesterday);
    });

    it("truncates the slot to the minute, so 12:00:07 is the 12:00 slot", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1, scheduledAt: new Date("2026-10-02T12:00:07.456Z") });
      const second = await run({ status: "skipped", source: "single", scheduledAt: noon });
      expect(second.outcome).toBe("updated");
      expect(await logsFor(bp.id)).toHaveLength(1);
    });

    it("lets one event complete different checks (BP and weight in one vitals entry)", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1 });
      await run({ check: weight, status: "done", source: "single", healthEventId: events.vitals1 });
      expect(await logsFor(bp.id)).toHaveLength(1);
      expect(await logsFor(weight.id)).toHaveLength(1);
    });
  });

  describe("conflict rules", () => {
    it("a single action overrides a prior log for the same slot, both ways", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1 });
      const skipped = await run({ status: "skipped", source: "single" });
      expect(skipped.outcome).toBe("updated");
      expect(skipped.log).toMatchObject({ status: "skipped", healthEventId: null });

      const done = await run({ status: "done", source: "single", healthEventId: events.vitals2 });
      expect(done.outcome).toBe("updated");
      expect(done.log).toMatchObject({ status: "done", healthEventId: events.vitals2 });
      expect(await logsFor(bp.id)).toHaveLength(1);
    });

    it("bulk never overrides a manual skip, or a completion", async () => {
      await clear();
      await run({ status: "skipped", source: "single" });
      const res = await run({ status: "done", source: "bulk", healthEventId: events.vitals1 });
      expect(res.outcome).toBe("unchanged");
      expect(res.log.status).toBe("skipped");

      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1 });
      const res2 = await run({ status: "skipped", source: "bulk" });
      expect(res2.outcome).toBe("unchanged");
      expect(res2.log).toMatchObject({ status: "done", healthEventId: events.vitals1 });
    });

    it("bulk fills a gap, and repeating it is idempotent", async () => {
      await clear();
      const first = await run({ status: "skipped", source: "bulk", scheduledAt: four });
      expect(first.outcome).toBe("inserted");
      for (let i = 0; i < 3; i++) {
        const again = await run({ status: "skipped", source: "bulk", scheduledAt: four });
        expect(again.outcome).toBe("unchanged");
      }
      expect(await logsFor(bp.id)).toHaveLength(1);
    });

    it("keeps slots independent", async () => {
      await clear();
      await run({ status: "skipped", source: "single", scheduledAt: noon });
      await run({ status: "skipped", source: "single", scheduledAt: four });
      expect(await logsFor(bp.id)).toHaveLength(2);
    });

    it("survives a race: concurrent singles leave exactly one row and no error", async () => {
      await clear();
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          run({ status: i % 2 === 0 ? "skipped" : "done", source: "single", healthEventId: i % 2 === 0 ? undefined : events.vitals1 }),
        ),
      );
      expect(results).toHaveLength(8);
      expect(await logsFor(bp.id)).toHaveLength(1);
    });

    it("survives a race between bulk writers: one insert, the rest unchanged", async () => {
      await clear();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => run({ status: "skipped", source: "bulk" })),
      );
      expect(results.filter((r) => r.outcome === "inserted").length).toBeGreaterThanOrEqual(1);
      expect(await logsFor(bp.id)).toHaveLength(1);
    });
  });

  describe("refusing a link", () => {
    it("needs an event to be done, and forbids one otherwise", async () => {
      await clear();
      expect(await codeOf(run({ status: "done", source: "single" }))).toBe("event_required");
      expect(await codeOf(run({ status: "skipped", source: "single", healthEventId: events.vitals1 }))).toBe("event_not_allowed");
      expect(await codeOf(run({ status: "missed", source: "single", healthEventId: events.vitals1 }))).toBe("event_not_allowed");
      expect(await logsFor(bp.id)).toHaveLength(0);
    });

    it("rejects an event that does not exist, belongs to someone else, or is the wrong kind", async () => {
      await clear();
      expect(await codeOf(run({ status: "done", source: "single", healthEventId: randomUUID() }))).toBe("event_not_found");
      expect(await codeOf(run({ status: "done", source: "single", healthEventId: events.otherMember }))).toBe("event_member_mismatch");
      // A pain entry cannot complete a blood pressure check.
      expect(await codeOf(run({ status: "done", source: "single", healthEventId: events.pain }))).toBe("event_type_mismatch");
      expect(await logsFor(bp.id)).toHaveLength(0);
    });

    it("rejects an event that already completes another slot of the same check", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1, scheduledAt: noon });
      expect(
        await codeOf(run({ status: "done", source: "single", healthEventId: events.vitals1, scheduledAt: four })),
      ).toBe("event_already_used");
      // Re-confirming the same slot with the same event is fine.
      expect(
        await codeOf(run({ status: "done", source: "single", healthEventId: events.vitals1, scheduledAt: noon })),
      ).toBe("no error");
      expect(await logsFor(bp.id)).toHaveLength(1);
    });

    it("rejects an event from another household", async () => {
      await clear();
      const foreign = await withSystemContext(db, async (tx) => {
        const [hh] = await tx.insert(households).values({ name: "recordCheck-foreign", timezone: "UTC" }).returning({ id: households.id });
        const [u] = await tx
          .insert(users)
          .values({ email: `recordcheck-f-${randomUUID()}@test.local`, displayName: "Foreign", emailVerified: true })
          .returning({ id: users.id });
        const [m] = await tx
          .insert(householdMembers)
          .values({ householdId: hh.id, userId: u.id, role: "owner", name: "Foreign" })
          .returning({ id: householdMembers.id });
        return { householdId: hh.id, userId: u.id, memberId: m.id };
      });
      try {
        const [event] = await withHouseholdContext(db, foreign.householdId, (tx) =>
          tx
            .insert(healthEvents)
            .values({ householdId: foreign.householdId, memberId: foreign.memberId, type: "vitals", title: "foreign" })
            .returning({ id: healthEvents.id }),
        );
        expect(await codeOf(run({ status: "done", source: "single", healthEventId: event!.id }))).toBe("event_not_found");
      } finally {
        await withSystemContext(db, async (tx) => {
          await tx.delete(households).where(eq(households.id, foreign.householdId));
          await tx.delete(users).where(eq(users.id, foreign.userId));
        });
      }
    });
  });


  describe("editing a log (WHO-385)", () => {
    const eight = new Date("2026-10-02T08:00:00.000Z");

    const rowFor = async (checkId: string, at: Date) => {
      const rows = await logsFor(checkId);
      return rows.find((r) => r.scheduledAt.getTime() === at.getTime())!;
    };
    const edit = async (
      patch: EditCheckLogInput["patch"],
      over: { at?: Date; check?: typeof bp } = {},
    ) => {
      const check = over.check ?? bp;
      const log = await rowFor(check.id, over.at ?? noon);
      return withHouseholdContext(db, householdId, (tx) =>
        editCheckLog(tx, env, { check, log, loggedByUserId: userId, now: new Date("2026-10-03T00:00:00.000Z"), patch }),
      );
    };
    const eventExists = async (id: string) =>
      (await withHouseholdContext(db, householdId, (tx) => tx.select({ id: healthEvents.id }).from(healthEvents).where(eq(healthEvents.id, id)))).length === 1;

    it("done to skipped unlinks the entry but leaves it alone", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1 });
      const { log, outcome } = await edit({ status: "skipped" });
      expect(outcome).toBe("updated");
      expect(log).toMatchObject({ status: "skipped", healthEventId: null, loggedByUserId: userId });
      expect(await eventExists(events.vitals1)).toBe(true);
    });

    it("skipped to done needs an entry, and only done may have one", async () => {
      await clear();
      await run({ status: "skipped", source: "single" });
      expect(await codeOf(edit({ status: "done" }))).toBe("event_required");
      expect(await codeOf(edit({ status: "done", healthEventId: null }))).toBe("event_required");
      expect(await codeOf(edit({ healthEventId: events.vitals1 }))).toBe("event_not_allowed");
      const done = await edit({ status: "done", healthEventId: events.vitals1 });
      expect(done.log).toMatchObject({ status: "done", healthEventId: events.vitals1 });

      // And a done slot cannot lose its entry without becoming something else.
      expect(await codeOf(edit({ healthEventId: null }))).toBe("event_required");
      expect((await rowFor(bp.id, noon)).status).toBe("done");
    });

    it("swaps the entry, applying the same rules as logging", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1 });
      expect((await edit({ healthEventId: events.vitals2 })).log.healthEventId).toBe(events.vitals2);
      expect(await codeOf(edit({ healthEventId: events.pain }))).toBe("event_type_mismatch");
      expect(await codeOf(edit({ healthEventId: events.otherMember }))).toBe("event_member_mismatch");
      expect(await codeOf(edit({ healthEventId: randomUUID() }))).toBe("event_not_found");
      expect((await rowFor(bp.id, noon)).healthEventId).toBe(events.vitals2);
    });

    it("refuses an entry that already completes another slot of the check", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1, scheduledAt: eight });
      await run({ status: "done", source: "single", healthEventId: events.vitals2, scheduledAt: noon });
      expect(await codeOf(edit({ healthEventId: events.vitals1 }))).toBe("event_already_used");
    });

    it("moves a log to a free slot, keeping its entry, and not counting against itself", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1 });
      const moved = await edit({ scheduledAt: new Date("2026-10-02T16:00:30.900Z") });
      expect(moved.log.scheduledAt).toBe(four.toISOString()); // truncated to the minute
      expect(moved.log.healthEventId).toBe(events.vitals1);
      expect(await logsFor(bp.id)).toHaveLength(1);
    });

    it("will not move onto a slot that already has a log", async () => {
      await clear();
      await run({ status: "skipped", source: "single", scheduledAt: noon });
      await run({ status: "skipped", source: "single", scheduledAt: four });
      expect(await codeOf(edit({ scheduledAt: four }))).toBe("slot_taken");
      expect((await logsFor(bp.id)).map((l) => l.scheduledAt.toISOString()).sort()).toEqual([noon.toISOString(), four.toISOString()]);
    });

    it("two logs racing for one free slot: one moves, the other is refused", async () => {
      await clear();
      await run({ status: "skipped", source: "single", scheduledAt: noon });
      await run({ status: "skipped", source: "single", scheduledAt: eight });
      const target = new Date("2026-10-02T20:00:00.000Z");
      const settled = await Promise.allSettled([
        edit({ scheduledAt: target }, { at: noon }),
        edit({ scheduledAt: target }, { at: eight }),
      ]);
      const codes = settled.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as RecordCheckError).code));
      expect(codes.sort()).toEqual(["ok", "slot_taken"]);
      expect(await logsFor(bp.id)).toHaveLength(2);
    });

    it("edits a note without counting as a new decision", async () => {
      await clear();
      const first = await run({ status: "done", source: "single", healthEventId: events.vitals1, notes: "first" });
      const edited = await edit({ notes: "after a walk" });
      expect(edited.outcome).toBe("updated");
      expect(edited.log.notes).toBe("after a walk");
      expect(edited.log.loggedAt).toBe(first.log.loggedAt); // not re-stamped
      const [row] = await logsFor(bp.id);
      expect(row!.notes!.startsWith("enc:v1:")).toBe(true);

      const cleared = await edit({ notes: null });
      expect(cleared.log.notes).toBeNull();
    });

    it("changing nothing is a no-op", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1 });
      expect((await edit({})).outcome).toBe("unchanged");
      expect((await edit({ status: "done", healthEventId: events.vitals1 })).outcome).toBe("unchanged");
    });

    it("can answer a system-set missed slot", async () => {
      await clear();
      await run({ status: "missed", source: "single" });
      expect(await codeOf(edit({ status: "done" }))).toBe("event_required");
      expect((await edit({ status: "done", healthEventId: events.vitals1 })).log.status).toBe("done");
      await clear();
      await run({ status: "missed", source: "single" });
      expect((await edit({ status: "skipped" })).log.status).toBe("skipped");
    });
  });

  describe("undoing a log (WHO-385)", () => {
    const undo = async (checkId: string, deleteEvent: boolean, at = noon) => {
      const [log] = (await logsFor(checkId)).filter((l) => l.scheduledAt.getTime() === at.getTime());
      return withHouseholdContext(db, householdId, (tx) => deleteCheckLog(tx, { log: log!, deleteEvent }));
    };
    const eventExists = async (id: string) =>
      (await withHouseholdContext(db, householdId, (tx) => tx.select({ id: healthEvents.id }).from(healthEvents).where(eq(healthEvents.id, id)))).length === 1;

    it("removes the log and keeps the person's reading", async () => {
      await clear();
      await run({ status: "done", source: "single", healthEventId: events.vitals1 });
      expect(await undo(bp.id, false)).toEqual({ deletedEvent: false });
      expect(await logsFor(bp.id)).toHaveLength(0);
      expect(await eventExists(events.vitals1)).toBe(true);
    });

    it("deletes the reading too when asked", async () => {
      await clear();
      await makeEvent("disposable", memberId, "vitals");
      await run({ status: "done", source: "single", healthEventId: events.disposable });
      expect(await undo(bp.id, true)).toEqual({ deletedEvent: true });
      expect(await logsFor(bp.id)).toHaveLength(0);
      expect(await eventExists(events.disposable)).toBe(false);
    });

    it("refuses to delete a reading that also completes another check, and changes nothing", async () => {
      await clear();
      await makeEvent("shared", memberId, "vitals");
      await run({ status: "done", source: "single", healthEventId: events.shared });
      await run({ check: weight, status: "done", source: "single", healthEventId: events.shared });
      expect(await codeOf(undo(bp.id, true))).toBe("event_in_use");
      expect(await logsFor(bp.id)).toHaveLength(1);
      expect(await logsFor(weight.id)).toHaveLength(1);
      expect(await eventExists(events.shared)).toBe(true);
      // Without the delete flag the same undo is fine.
      expect(await undo(bp.id, false)).toEqual({ deletedEvent: false });
      expect(await eventExists(events.shared)).toBe(true);
    });

    it("undoing a skip has no entry to delete", async () => {
      await clear();
      await run({ status: "skipped", source: "single" });
      expect(await undo(bp.id, true)).toEqual({ deletedEvent: false });
      expect(await logsFor(bp.id)).toHaveLength(0);
    });
  });

  describe("a reading that stops being the right entry (WHO-385)", () => {
    it("unlinkCheckLogsForEvent removes every completion it backs, and only those", async () => {
      await clear();
      await makeEvent("backs", memberId, "vitals");
      await run({ status: "done", source: "single", healthEventId: events.backs });
      await run({ check: weight, status: "done", source: "single", healthEventId: events.backs });
      await run({ status: "done", source: "single", healthEventId: events.vitals1, scheduledAt: four });
      await run({ status: "skipped", source: "single", scheduledAt: new Date("2026-10-02T20:00:00.000Z") });

      const removed = await withHouseholdContext(db, householdId, (tx) => unlinkCheckLogsForEvent(tx, events.backs));
      expect(removed).toBe(2);
      expect((await logsFor(bp.id)).map((l) => l.status).sort()).toEqual(["done", "skipped"]);
      expect(await logsFor(weight.id)).toHaveLength(0);
      expect(await withHouseholdContext(db, householdId, (tx) => unlinkCheckLogsForEvent(tx, events.backs))).toBe(0);
    });
  });
});
