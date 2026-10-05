import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { addDaysUtc, todayIsoDateInTz } from "@domi-ops/calendar-sync";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
  healthMemberAcl,
  healthOrganizerPlans,
  healthOrganizerSessionFills,
  healthOrganizerSessions,
  healthPharmacies,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { createTenantMiddleware } from "../middleware/tenant.js";
import { householdHealthRoutes } from "./household-health.js";
import { healthSupplyRoutes } from "./health-supply.js";

/**
 * WHO-419: medication supply through the API, against a real Postgres as the app role. Auth is faked
 * by a parent app from the `x-as` header; the tenant middleware and everything below are real code.
 * The household clock is UTC, so "today" is todayIsoDateInTz("UTC"). Skipped without a database.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = {
  MODULES_ENABLED: ["core", "health"],
  DEPLOYMENT_MODE: "single",
  AUTH_REQUIRED: true,
  ENCRYPTION_KEY: "test-health-encryption-key-32chars!!",
} as unknown as Env;

type Role = "owner" | "admin" | "member" | "child";
type Person = { userId: string; memberId: string; householdId: string; role: Role };
// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
type Json = any;

maybeDescribe("medication supply (integration)", () => {
  const marker = `who419-${Date.now()}`;
  const today = () => todayIsoDateInTz("UTC");
  const plus = (n: number) => addDaysUtc(today(), n);
  let baseDb: Database;
  let app: Hono<{ Variables: AppVariables }>;
  let hhId = "";
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const people: Record<string, Person> = {};

  async function seedHousehold(name: string, members: { key: string; role: Role }[]): Promise<string> {
    return withSystemContext(baseDb, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name, timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdIds.push(hh.id);
      for (const m of members) {
        const [u] = await tx
          .insert(users)
          .values({ email: `who419-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
          .returning({ id: users.id });
        userIds.push(u.id);
        const [row] = await tx
          .insert(householdMembers)
          .values({ householdId: hh.id, userId: u.id, role: m.role, name: m.key })
          .returning({ id: householdMembers.id });
        people[m.key] = { userId: u.id, memberId: row.id, householdId: hh.id, role: m.role };
      }
      return hh.id;
    });
  }

  const call = async (as: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> => {
    const res = await app.request(path, {
      method,
      headers: { "x-as": as, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  async function makeMed(
    over: Partial<typeof healthMedications.$inferInsert> = {},
    memberKey = "ally",
    createdBy = "mom",
  ): Promise<string> {
    return withHouseholdContext(baseDb, hhId, async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({
          householdId: hhId,
          memberId: people[memberKey]!.memberId,
          name: `${marker} med ${randomUUID().slice(0, 6)}`,
          scheduleKind: "prn",
          scheduleJson: "{}",
          visibility: "household",
          createdByUserId: people[createdBy]!.userId,
          ...over,
        })
        .returning({ id: healthMedications.id });
      return m.id;
    });
  }

  async function fill(medicationId: string, from: string, to: string, undone = false) {
    await withHouseholdContext(baseDb, hhId, async (tx) => {
      let [plan] = await tx.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.memberId, people.ally!.memberId));
      if (!plan) {
        [plan] = await tx
          .insert(healthOrganizerPlans)
          .values({ householdId: hhId, memberId: people.ally!.memberId, scheduleKind: "every_n_days", everyN: 30, anchorDate: today() })
          .returning();
      }
      let [session] = await tx.select().from(healthOrganizerSessions).where(eq(healthOrganizerSessions.planId, plan!.id));
      if (!session) {
        [session] = await tx
          .insert(healthOrganizerSessions)
          .values({ planId: plan!.id, coverageStart: today(), fillLengthDays: 31, snapshotJson: "{}", snapshotHash: "h" })
          .returning();
      }
      await tx.insert(healthOrganizerSessionFills).values({
        sessionId: session!.id,
        medicationId,
        coveredFrom: from,
        coveredTo: to,
        idempotencyKey: randomUUID(),
        undoneAt: undone ? new Date() : null,
      });
    });
  }

  const put = (as: string, id: string, body: Record<string, unknown>) => call(as, "PUT", `/health/medications/${id}/supply`, body);
  const ok = async (as: string, id: string, body: Record<string, unknown>): Promise<Json> => {
    const res = await put(as, id, body);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json;
  };
  const revisions = (id: string) =>
    withHouseholdContext(baseDb, hhId, (tx) =>
      tx.select().from(healthMedicationSupplyRevisions).where(eq(healthMedicationSupplyRevisions.medicationId, id)).orderBy(asc(healthMedicationSupplyRevisions.revision)),
    );
  const listed = async (as: string, id: string): Promise<Json> => {
    const res = await call(as, "GET", "/health/medications");
    expect(res.status).toBe(200);
    return res.json.medications.find((m: Json) => m.id === id);
  };

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    hhId = await seedHousehold(`${marker}-home`, [
      { key: "mom", role: "owner" },
      { key: "ally", role: "child" },
      { key: "reader", role: "member" },
      { key: "writer", role: "member" },
    ]);
    await seedHousehold(`${marker}-other`, [{ key: "outsider", role: "owner" }]);
    await withHouseholdContext(baseDb, hhId, (tx) =>
      tx.insert(healthMemberAcl).values([
        { householdId: hhId, subjectMemberId: people.ally!.memberId, granteeMemberId: people.reader!.memberId, medicationsAccess: "read" },
        { householdId: hhId, subjectMemberId: people.ally!.memberId, granteeMemberId: people.writer!.memberId, medicationsAccess: "write" },
      ]),
    );

    const scoped = createScopedDb(baseDb);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      const who = people[c.req.header("x-as") ?? ""];
      c.set("userId", who?.userId ?? null);
      c.set(
        "auth",
        who
          ? { userId: who.userId, householdId: who.householdId, memberId: who.memberId, email: null, username: null, name: null, role: who.role }
          : null,
      );
      return next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.route("/health", householdHealthRoutes(scoped, env));
    app.route("/health", healthSupplyRoutes(scoped, env));
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("the estimate", () => {
    it("saves days outside the organizers as the first date without supply, with a revision", async () => {
      const id = await makeMed();
      const res = await ok("mom", id, { outsideDays: 10 });
      expect(res.supply).toMatchObject({
        runsOutOn: plus(10),
        estimatedOn: today(),
        daysRemaining: 10,
        outsideDays: 10,
        organizerDaysCounted: 0,
        revision: 1,
        version: 1,
        leadDays: 7,
        leadDaysOverride: null,
        state: "ok",
        deadline: plus(3),
        overdue: false,
        requestedAt: null,
        needsConfirmation: false,
      });
      expect(res.pharmacy).toBeNull();
      const revs = await revisions(id);
      expect(revs).toHaveLength(1);
      expect(revs[0]).toMatchObject({ revision: 1, source: "manual", runsOutOn: plus(10), outsideDays: 10, organizerDaysCounted: 0, createdByUserId: people.mom!.userId });
    });

    it("adds what the organizers still hold, counting today and ignoring undone fills", async () => {
      const id = await makeMed();
      await fill(id, plus(-5), plus(30)); // started in the past: 31 days from today
      await fill(id, plus(200), plus(230), true); // undone, never counted
      const res = await ok("mom", id, { outsideDays: 10 });
      expect(res.supply).toMatchObject({ runsOutOn: plus(41), outsideDays: 10, organizerDaysCounted: 31, daysRemaining: 41 });
      expect(await revisions(id)).toMatchObject([{ runsOutOn: plus(41), outsideDays: 10, organizerDaysCounted: 31 }]);
    });

    it("refuses an implicit total when the organizers have a gap, and takes a confirmed one", async () => {
      const id = await makeMed();
      await fill(id, today(), plus(9));
      await fill(id, plus(15), plus(20));
      const refused = await put("mom", id, { outsideDays: 5 });
      expect(refused.status).toBe(409);
      expect(refused.json).toMatchObject({ error: "confirmation_required", organizerDays: 10, organizerEndsOn: plus(9) });
      expect(await revisions(id)).toHaveLength(0);
      const saved = await ok("mom", id, { outsideDays: 5, confirmedTotalDays: 25 });
      expect(saved.supply).toMatchObject({ runsOutOn: plus(25), organizerDaysCounted: 10, outsideDays: 15 });
    });

    it("previews with dryRun and writes nothing", async () => {
      const id = await makeMed();
      await fill(id, today(), plus(30));
      const preview = await put("mom", id, { outsideDays: 4, dryRun: true });
      expect(preview.status).toBe(200);
      expect(preview.json).toMatchObject({ dryRun: true, needsConfirmation: false, runsOutOn: plus(35), totalDays: 35, organizerDays: 31, outsideDays: 4 });
      expect(await revisions(id)).toHaveLength(0);
      const stored = await withHouseholdContext(baseDb, hhId, (tx) => tx.select().from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, id)));
      expect(stored).toHaveLength(0);
    });

    it("previews a gap as needing confirmation instead of failing", async () => {
      const id = await makeMed();
      await fill(id, plus(3), plus(9));
      const preview = await put("mom", id, { outsideDays: 4, dryRun: true });
      expect(preview.status).toBe(200);
      expect(preview.json).toMatchObject({ dryRun: true, needsConfirmation: true, organizerDays: 0 });
    });

    it("refuses a total beyond ten years", async () => {
      const id = await makeMed();
      await fill(id, today(), plus(30));
      const res = await put("mom", id, { outsideDays: 3650 });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("supply_too_large");
    });

    it("works for scheduled medications as well as as-needed ones", async () => {
      const id = await makeMed({ scheduleKind: "scheduled", scheduleJson: JSON.stringify({ times: ["08:00"] }) });
      expect((await ok("mom", id, { outsideDays: 30 })).supply.runsOutOn).toBe(plus(30));
    });
  });

  describe("versions, revisions and retries", () => {
    it("needs the version it is changing, and keeps every revision", async () => {
      const id = await makeMed();
      const first = await ok("mom", id, { outsideDays: 10 });
      const noVersion = await put("mom", id, { outsideDays: 20 });
      expect(noVersion.status).toBe(409);
      expect(noVersion.json.error).toBe("version_conflict");
      expect(noVersion.json.supply.version).toBe(1);
      expect((await put("mom", id, { outsideDays: 20, version: 7 })).status).toBe(409);
      const second = await ok("mom", id, { outsideDays: 20, version: first.supply.version });
      expect(second.supply).toMatchObject({ revision: 2, version: 2, runsOutOn: plus(20) });
      const revs = await revisions(id);
      expect(revs.map((r) => [r.revision, r.runsOutOn])).toEqual([[1, plus(10)], [2, plus(20)]]);
    });

    it("does not start with a version for a medication that has no supply yet", async () => {
      const id = await makeMed();
      const res = await put("mom", id, { outsideDays: 10, version: 1 });
      expect(res.status).toBe(409);
    });

    it("answers a repeated request with the saved result instead of a second revision", async () => {
      const id = await makeMed();
      const key = randomUUID();
      const first = await ok("mom", id, { outsideDays: 10, idempotencyKey: key });
      const again = await ok("mom", id, { outsideDays: 10, idempotencyKey: key });
      expect(again.replayed).toBe(true);
      expect(again.supply).toEqual(first.supply);
      expect(await revisions(id)).toHaveLength(1);
      // the same key after the first change but with a stale version is still a replay
      const next = await ok("mom", id, { outsideDays: 12, version: 1, idempotencyKey: "second" });
      expect(next.supply.revision).toBe(2);
      expect((await ok("mom", id, { outsideDays: 12, version: 1, idempotencyKey: "second" })).replayed).toBe(true);
      expect(await revisions(id)).toHaveLength(2);
    });

    it("lets only one of two concurrent edits of the same version win", async () => {
      const id = await makeMed();
      const first = await ok("mom", id, { outsideDays: 10 });
      const results = await Promise.all([
        put("mom", id, { outsideDays: 11, version: first.supply.version }),
        put("writer", id, { outsideDays: 12, version: first.supply.version }),
        put("mom", id, { leadDays: 3, version: first.supply.version }),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      const stored = await withHouseholdContext(baseDb, hhId, (tx) => tx.select().from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, id)));
      expect(stored[0]!.version).toBe(2);
      const revs = await revisions(id);
      expect(revs.length).toBe(stored[0]!.revision);
    });

    it("refuses an edit whose version went stale while it was waiting on the row", async () => {
      const id = await makeMed();
      await ok("mom", id, { outsideDays: 10 });
      let locked!: () => void;
      let release!: () => void;
      const hasLock = new Promise<void>((r) => (locked = r));
      const go = new Promise<void>((r) => (release = r));
      // Another writer holds the row, then bumps its version, after our request has already read it.
      const holder = withHouseholdContext(baseDb, hhId, async (tx) => {
        await tx.execute(sql`select 1 from health_medication_supply where medication_id = ${id} for update`);
        locked();
        await go;
        await tx.update(healthMedicationSupply).set({ version: sql`${healthMedicationSupply.version} + 1`, outsideDays: 99 }).where(eq(healthMedicationSupply.medicationId, id));
      });
      await hasLock;
      const pending = put("mom", id, { outsideDays: 20, version: 1 });
      await new Promise((r) => setTimeout(r, 400));
      release();
      await holder;
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("version_conflict");
      expect(await revisions(id)).toHaveLength(1);
    });

    it("lets concurrent first estimates create the row only once", async () => {
      const id = await makeMed();
      const results = await Promise.all([put("mom", id, { outsideDays: 5 }), put("writer", id, { outsideDays: 6 })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await revisions(id)).toHaveLength(1);
    });
  });

  describe("lead time and pharmacy", () => {
    it("uses the medication's own lead time, then the person's, then 7", async () => {
      const id = await makeMed();
      const a = await ok("mom", id, { outsideDays: 30 });
      expect(a.supply).toMatchObject({ leadDays: 7, deadline: plus(23) });
      const withPerson = await call("mom", "PUT", `/health/supply-settings/${people.ally!.memberId}`, { defaultLeadDays: 14 });
      expect(withPerson).toMatchObject({ status: 200, json: { defaultLeadDays: 14 } });
      expect((await listed("mom", id)).supply).toMatchObject({ leadDays: 14, leadDaysOverride: null, deadline: plus(16) });
      const override = await ok("mom", id, { leadDays: 3, version: a.supply.version });
      expect(override.supply).toMatchObject({ leadDays: 3, leadDaysOverride: 3, deadline: plus(27), revision: 1, version: 2 });
      expect(await revisions(id)).toHaveLength(1); // a lead time change is not a new estimate
      const cleared = await ok("mom", id, { leadDays: null, version: override.supply.version });
      expect(cleared.supply).toMatchObject({ leadDays: 14, leadDaysOverride: null });
      await call("mom", "PUT", `/health/supply-settings/${people.ally!.memberId}`, { defaultLeadDays: 7 });
    });

    it("accepts a lead time of 0 as a real value", async () => {
      const id = await makeMed();
      const res = await ok("mom", id, { outsideDays: 10, leadDays: 0 });
      expect(res.supply).toMatchObject({ leadDays: 0, leadDaysOverride: 0, deadline: plus(10) });
    });

    it("assigns, shows and clears one pharmacy; refuses archived and foreign ones", async () => {
      const id = await makeMed();
      const mk = (householdId: string, name: string, archived = false) =>
        withHouseholdContext(baseDb, householdId, async (tx) => {
          const [p] = await tx.insert(healthPharmacies).values({ householdId, name, archivedAt: archived ? new Date() : null }).returning({ id: healthPharmacies.id });
          return p.id;
        });
      const mine = await mk(hhId, "Corner Drug");
      const archived = await mk(hhId, "Closed Drug", true);
      const theirs = await mk(people.outsider!.householdId, "Their Drug");

      const assigned = await ok("mom", id, { pharmacyId: mine });
      expect(assigned.pharmacy).toEqual({ id: mine, name: "Corner Drug", archived: false });
      expect(assigned.supply).toMatchObject({ runsOutOn: null, daysRemaining: null, state: "no_estimate", version: 1 });
      expect((await put("mom", id, { pharmacyId: archived, version: 1 })).json.error).toBe("pharmacy_archived");
      expect((await put("mom", id, { pharmacyId: theirs, version: 1 })).status).toBe(404);
      expect((await put("mom", id, { pharmacyId: randomUUID(), version: 1 })).status).toBe(404);
      expect((await put("mom", id, { pharmacyId: "nope", version: 1 })).status).toBe(404);
      const cleared = await ok("mom", id, { pharmacyId: null, version: 1 });
      expect(cleared.pharmacy).toBeNull();
    });

    it("keeps showing a pharmacy that was archived after it was assigned", async () => {
      const id = await makeMed();
      const ph = await withHouseholdContext(baseDb, hhId, async (tx) => {
        const [p] = await tx.insert(healthPharmacies).values({ householdId: hhId, name: "Later Closed" }).returning({ id: healthPharmacies.id });
        return p.id;
      });
      await ok("mom", id, { pharmacyId: ph });
      await withHouseholdContext(baseDb, hhId, (tx) => tx.update(healthPharmacies).set({ archivedAt: new Date() }).where(eq(healthPharmacies.id, ph)));
      expect((await listed("mom", id)).pharmacy).toEqual({ id: ph, name: "Later Closed", archived: true });
    });
  });

  describe("pause, resume and delete", () => {
    it("drops a paused medication out of tracking, and asks for confirmation once it is resumed", async () => {
      const id = await makeMed();
      await ok("mom", id, { outsideDays: 20 });
      expect((await listed("mom", id)).supply).toMatchObject({ state: "ok", needsConfirmation: false });

      expect((await call("mom", "PATCH", `/health/medications/${id}`, { enabled: false })).status).toBe(200);
      expect((await listed("mom", id)).supply).toMatchObject({ state: "inactive", needsConfirmation: false });

      await new Promise((r) => setTimeout(r, 20));
      const resumed = await call("mom", "PATCH", `/health/medications/${id}`, { enabled: true });
      expect(resumed.status).toBe(200);
      expect(resumed.json.medication.supply).toMatchObject({ state: "ok", needsConfirmation: true });

      const confirmed = await ok("mom", id, { confirm: true, version: 1 });
      expect(confirmed.supply).toMatchObject({ needsConfirmation: false, revision: 2, runsOutOn: plus(20) });
      const revs = await revisions(id);
      expect(revs.map((r) => r.source)).toEqual(["manual", "confirm"]);
    });

    it("clears the prompt by replacing the estimate too", async () => {
      const id = await makeMed();
      await ok("mom", id, { outsideDays: 20 });
      await call("mom", "PATCH", `/health/medications/${id}`, { enabled: false });
      await new Promise((r) => setTimeout(r, 20));
      await call("mom", "PATCH", `/health/medications/${id}`, { enabled: true });
      const replaced = await ok("mom", id, { outsideDays: 9, version: 1 });
      expect(replaced.supply).toMatchObject({ needsConfirmation: false, runsOutOn: plus(9) });
    });

    it("has nothing to confirm without an estimate", async () => {
      const id = await makeMed();
      expect((await put("mom", id, { confirm: true })).json.error).toBe("no_estimate_to_confirm");
      await ok("mom", id, { leadDays: 5 });
      expect((await put("mom", id, { confirm: true, version: 1 })).json.error).toBe("no_estimate_to_confirm");
    });

    it("treats a deleted medication as not found and reports it inactive before that", async () => {
      const id = await makeMed();
      await ok("mom", id, { outsideDays: 20 });
      await withHouseholdContext(baseDb, hhId, (tx) => tx.update(healthMedications).set({ deletedAt: new Date() }).where(eq(healthMedications.id, id)));
      expect((await put("mom", id, { outsideDays: 5, version: 1 })).status).toBe(404);
    });
  });

  describe("who may see and change it", () => {
    it("lets a reader see the summary but not change it", async () => {
      const id = await makeMed();
      await ok("mom", id, { outsideDays: 10 });
      expect((await listed("reader", id)).supply.runsOutOn).toBe(plus(10));
      const res = await put("reader", id, { outsideDays: 99, version: 1 });
      expect(res.status).toBe(403);
      expect((await listed("mom", id)).supply.runsOutOn).toBe(plus(10));
    });

    it("lets a writer change it, until the access is revoked", async () => {
      const id = await makeMed();
      await ok("writer", id, { outsideDays: 10 });
      await withHouseholdContext(baseDb, hhId, (tx) =>
        tx.delete(healthMemberAcl).where(and(eq(healthMemberAcl.subjectMemberId, people.ally!.memberId), eq(healthMemberAcl.granteeMemberId, people.writer!.memberId))),
      );
      try {
        expect((await put("writer", id, { outsideDays: 20, version: 1 })).status).toBe(403);
      } finally {
        await withHouseholdContext(baseDb, hhId, (tx) =>
          tx.insert(healthMemberAcl).values({ householdId: hhId, subjectMemberId: people.ally!.memberId, granteeMemberId: people.writer!.memberId, medicationsAccess: "write" }),
        );
      }
    });

    it("does not reveal a private medication to someone who cannot see it", async () => {
      const id = await makeMed({ visibility: "private" }, "mom", "mom");
      await ok("mom", id, { outsideDays: 10 });
      expect((await put("writer", id, { outsideDays: 5 })).status).toBe(404);
      expect((await put("reader", id, { outsideDays: 5 })).status).toBe(404);
      const row = await call("writer", "GET", "/health/medications");
      expect(row.json.medications.map((m: Json) => m.id)).not.toContain(id);
    });

    it("keeps households apart", async () => {
      const id = await makeMed();
      expect((await put("outsider", id, { outsideDays: 5 })).status).toBe(404);
      expect((await put("mom", randomUUID(), { outsideDays: 5 })).status).toBe(404);
      expect((await put("mom", "not-a-uuid", { outsideDays: 5 })).status).toBe(404);
    });

    it("gates the person-wide lead time the same way", async () => {
      const url = `/health/supply-settings/${people.ally!.memberId}`;
      expect((await call("reader", "GET", url)).status).toBe(200);
      expect((await call("reader", "PUT", url, { defaultLeadDays: 3 })).status).toBe(403);
      expect((await call("writer", "PUT", url, { defaultLeadDays: 7 })).status).toBe(200);
      expect((await call("reader", "GET", `/health/supply-settings/${people.mom!.memberId}`)).status).toBe(403);
      expect((await call("outsider", "GET", url)).status).toBe(404);
      expect((await call("mom", "GET", "/health/supply-settings/nope")).status).toBe(404);
      for (const bad of [-1, 91, 1.5, "7", null]) {
        expect((await call("mom", "PUT", url, { defaultLeadDays: bad })).status, String(bad)).toBe(400);
      }
    });
  });

  describe("input", () => {
    it("refuses bad input with a code and writes nothing", async () => {
      const id = await makeMed();
      const bad: Array<[Record<string, unknown>, string]> = [
        [{}, "nothing_to_change"],
        [{ version: 1 }, "nothing_to_change"],
        [{ outsideDays: -1 }, "invalid_outside_days"],
        [{ outsideDays: 1.5 }, "invalid_outside_days"],
        [{ outsideDays: "5" }, "invalid_outside_days"],
        [{ outsideDays: 3651 }, "invalid_outside_days"],
        [{ outsideDays: 5, confirmedTotalDays: -2 }, "invalid_confirmed_total"],
        [{ confirmedTotalDays: 5 }, "confirmed_total_needs_outside_days"],
        [{ confirm: true, outsideDays: 5 }, "confirm_with_estimate"],
        [{ confirm: "yes" }, "invalid_body"],
        [{ leadDays: 91 }, "invalid_lead_days"],
        [{ leadDays: -1 }, "invalid_lead_days"],
        [{ leadDays: "3" }, "invalid_lead_days"],
        [{ outsideDays: 5, version: 0 }, "invalid_version"],
        [{ outsideDays: 5, version: "1" }, "invalid_version"],
        [{ outsideDays: 5, idempotencyKey: "" }, "invalid_idempotency_key"],
        [{ outsideDays: 5, idempotencyKey: "k".repeat(101) }, "invalid_idempotency_key"],
        [{ leadDays: 3, dryRun: true }, "dry_run_needs_outside_days"],
        [{ outsideDays: 5, dryRun: "yes" }, "invalid_body"],
      ];
      for (const [body, code] of bad) {
        const res = await put("mom", id, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.json.error, JSON.stringify(body)).toBe(code);
      }
      const raw = await app.request(`/health/medications/${id}/supply`, { method: "PUT", headers: { "x-as": "mom", "content-type": "application/json" }, body: "not json" });
      expect(raw.status).toBe(400);
      const stored = await withHouseholdContext(baseDb, hhId, (tx) => tx.select().from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, id)));
      expect(stored).toHaveLength(0);
    });
  });

  describe("on medication responses", () => {
    it("adds supply and pharmacy only when something was set, and changes nothing else", async () => {
      const bare = await makeMed();
      const m = await listed("mom", bare);
      expect(m).not.toHaveProperty("supply");
      expect(m).not.toHaveProperty("pharmacy");
      for (const key of ["id", "memberId", "name", "scheduleKind", "enabled", "visibility", "canEdit", "canLog", "doseQuantities"]) expect(m, key).toHaveProperty(key);
      await ok("mom", bare, { outsideDays: 20 });
      const after = await listed("mom", bare);
      expect(after.supply).toMatchObject({ runsOutOn: plus(20), state: "ok", daysRemaining: 20 });
      expect(after).toHaveProperty("pharmacy", null);
    });

    it("computes the state for today, from the stored run-out date", async () => {
      const id = await makeMed();
      // Seed an estimate that was made 20 days ago and runs out in 5 days; nothing else has changed.
      await withHouseholdContext(baseDb, hhId, async (tx) => {
        await tx.insert(healthMedicationSupply).values({ medicationId: id, runsOutOn: plus(5), estimatedOn: plus(-20), outsideDays: 25, organizerDaysCounted: 0, revision: 1 });
      });
      expect((await listed("mom", id)).supply).toMatchObject({ daysRemaining: 5, state: "needs_refill", deadline: plus(-2), overdue: true });
      await withHouseholdContext(baseDb, hhId, (tx) => tx.update(healthMedicationSupply).set({ requestedAt: new Date() }).where(eq(healthMedicationSupply.medicationId, id)));
      expect((await listed("mom", id)).supply).toMatchObject({ state: "requested", overdue: true });
      await withHouseholdContext(baseDb, hhId, (tx) => tx.update(healthMedicationSupply).set({ requestedAt: null }).where(eq(healthMedicationSupply.medicationId, id)));
      await withHouseholdContext(baseDb, hhId, (tx) => tx.update(healthMedications).set({ endDate: plus(2) }).where(eq(healthMedications.id, id)));
      expect((await listed("mom", id)).supply).toMatchObject({ state: "not_needed" });
    });
  });
});
