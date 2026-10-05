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
  healthMedicationRefillEvents,
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
import { healthRefillRoutes } from "./health-refills.js";

/**
 * WHO-420: the refill workflow (Needs refill -> Requested -> Received) through the API, against a real
 * Postgres as the app role. Auth is faked by a parent app from the `x-as` header; the tenant middleware
 * and everything below are real code. The household clock is UTC. Skipped without a database.
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

maybeDescribe("refill workflow (integration)", () => {
  const marker = `who420-${Date.now()}`;
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
          .values({ email: `who420-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
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

  async function makeMed(over: Partial<typeof healthMedications.$inferInsert> = {}, memberKey = "ally", createdBy = "mom"): Promise<string> {
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

  /** A stored estimate that runs out `days` from today (made 30 days ago), optionally already requested. */
  async function withEstimate(id: string, days: number, extra: Partial<typeof healthMedicationSupply.$inferInsert> = {}) {
    await withHouseholdContext(baseDb, hhId, (tx) =>
      tx.insert(healthMedicationSupply).values({ medicationId: id, runsOutOn: plus(days), estimatedOn: plus(-30), outsideDays: days + 30, organizerDaysCounted: 0, revision: 1, ...extra }),
    );
  }

  async function pharmacy(name: string): Promise<string> {
    return withHouseholdContext(baseDb, hhId, async (tx) => {
      const [p] = await tx.insert(healthPharmacies).values({ householdId: hhId, name }).returning({ id: healthPharmacies.id });
      return p.id;
    });
  }

  async function fill(medicationId: string, from: string, to: string) {
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
      await tx.insert(healthOrganizerSessionFills).values({ sessionId: session!.id, medicationId, coveredFrom: from, coveredTo: to, idempotencyKey: randomUUID() });
    });
  }

  const request = (as: string, id: string) => call(as, "POST", `/health/medications/${id}/supply/request`, {});
  const receive = (as: string, id: string, body: Record<string, unknown>) => call(as, "POST", `/health/medications/${id}/supply/receive`, body);
  const events = (id: string) =>
    withHouseholdContext(baseDb, hhId, (tx) =>
      tx.select().from(healthMedicationRefillEvents).where(eq(healthMedicationRefillEvents.medicationId, id)).orderBy(asc(healthMedicationRefillEvents.createdAt)),
    );
  const revisions = (id: string) =>
    withHouseholdContext(baseDb, hhId, (tx) =>
      tx.select().from(healthMedicationSupplyRevisions).where(eq(healthMedicationSupplyRevisions.medicationId, id)).orderBy(asc(healthMedicationSupplyRevisions.revision)),
    );
  const stored = async (id: string) =>
    (await withHouseholdContext(baseDb, hhId, (tx) => tx.select().from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, id))))[0];
  const refills = async (as: string, query = ""): Promise<Json> => {
    const res = await call(as, "GET", `/health/refills${query}`);
    expect(res.status).toBe(200);
    return res.json;
  };

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    hhId = await seedHousehold(`${marker}-home`, [
      { key: "mom", role: "owner" },
      { key: "ally", role: "child" },
      { key: "ben", role: "child" },
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
    app.route("/health", healthRefillRoutes(scoped, env));
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("the full cycle", () => {
    it("goes Needs refill -> Requested -> Received, with events and a receipt revision", async () => {
      const id = await makeMed();
      await withEstimate(id, 5); // lead 7: the deadline was 2 days ago
      const ph = await pharmacy(`${marker} Corner`);
      await withHouseholdContext(baseDb, hhId, (tx) => tx.update(healthMedicationSupply).set({ pharmacyId: ph }).where(eq(healthMedicationSupply.medicationId, id)));
      const find = async () => (await refills("mom")).groups.flatMap((g: Json) => g.medications).find((m: Json) => m.id === id);

      expect((await find()).supply).toMatchObject({ state: "needs_refill", overdue: true, requestedAt: null });

      const asked = await request("writer", id);
      expect(asked.status).toBe(200);
      expect(asked.json.alreadyRequested).toBe(false);
      expect(asked.json.supply).toMatchObject({ state: "requested", overdue: true, runsOutOn: plus(5) });
      expect(asked.json.supply.requestedAt).toEqual(expect.any(String));
      expect((await find()).requestedDaysAgo).toBe(0);
      expect(await events(id)).toMatchObject([{ kind: "requested", pharmacyId: ph, createdByUserId: people.writer!.userId }]);

      const got = await receive("writer", id, { outsideDays: 90 });
      expect(got.status, JSON.stringify(got.json)).toBe(200);
      expect(got.json.supply).toMatchObject({ state: "ok", runsOutOn: plus(90), daysRemaining: 90, revision: 2, requestedAt: null, outsideDays: 90 });
      expect(got.json.supply.receivedAt).toEqual(expect.any(String));
      expect(await find()).toBeUndefined(); // off the list now
      expect(await events(id)).toMatchObject([{ kind: "requested" }, { kind: "received", supplyRevision: 2, pharmacyId: ph }]);
      expect(await revisions(id)).toMatchObject([{ revision: 2, source: "receipt", runsOutOn: plus(90), createdByUserId: people.writer!.userId }]);
      const row = await stored(id);
      expect(row).toMatchObject({ requestedAt: null, requestedByUserId: null, revision: 2 });
    });

    it("keeps a request visible until it is received, even when asked for early", async () => {
      const id = await makeMed();
      await withEstimate(id, 60); // far from its deadline
      expect((await refills("mom")).groups.flatMap((g: Json) => g.medications.map((m: Json) => m.id))).not.toContain(id);
      await request("mom", id);
      const item = (await refills("mom")).groups.flatMap((g: Json) => g.medications).find((m: Json) => m.id === id);
      expect(item.supply).toMatchObject({ state: "requested", overdue: false });
    });

    it("shows how long ago it was requested", async () => {
      const id = await makeMed();
      await withEstimate(id, 2, { requestedAt: new Date(Date.now() - 3 * 86_400_000), requestedByUserId: people.mom!.userId });
      const item = (await refills("mom")).groups.flatMap((g: Json) => g.medications).find((m: Json) => m.id === id);
      expect(item).toMatchObject({ requestedDaysAgo: 3, supply: { state: "requested", overdue: true } });
    });

    it("works for a medication whose supply was never estimated", async () => {
      const id = await makeMed();
      const asked = await request("mom", id);
      expect(asked.json.supply).toMatchObject({ state: "requested", runsOutOn: null, version: 2 });
      const got = await receive("mom", id, { outsideDays: 30 });
      expect(got.json.supply).toMatchObject({ state: "ok", runsOutOn: plus(30), revision: 1 });
      // received without ever being requested
      const direct = await makeMed();
      expect((await receive("mom", direct, { outsideDays: 10 })).json.supply).toMatchObject({ runsOutOn: plus(10), requestedAt: null });
      expect(await events(direct)).toMatchObject([{ kind: "received", supplyRevision: 1 }]);
    });
  });

  describe("receipt arithmetic", () => {
    it("replaces the estimate with the new total plus what the organizers still hold", async () => {
      const id = await makeMed();
      await withEstimate(id, 3);
      await fill(id, plus(-2), plus(28)); // 29 days left in the box, counting today
      await request("mom", id);
      const got = await receive("mom", id, { outsideDays: 60 });
      expect(got.json.supply).toMatchObject({ runsOutOn: plus(89), organizerDaysCounted: 29, outsideDays: 60 });
      expect(await revisions(id)).toMatchObject([{ revision: 2, organizerDaysCounted: 29, outsideDays: 60 }]);
    });

    it("previews with dryRun and writes nothing, including the request", async () => {
      const id = await makeMed();
      await withEstimate(id, 3);
      await request("mom", id);
      const before = await stored(id);
      const preview = await receive("mom", id, { outsideDays: 40, dryRun: true });
      expect(preview.json).toMatchObject({ dryRun: true, needsConfirmation: false, runsOutOn: plus(40), totalDays: 40 });
      expect(await stored(id)).toEqual(before);
      expect(await events(id)).toHaveLength(1);
    });

    it("asks for the total in hand when the organizers have a gap, and takes it", async () => {
      const id = await makeMed();
      await withEstimate(id, 3);
      await fill(id, today(), plus(4));
      await fill(id, plus(10), plus(14));
      const refused = await receive("mom", id, { outsideDays: 20 });
      expect(refused.status).toBe(409);
      expect(refused.json).toMatchObject({ error: "confirmation_required", organizerDays: 5, organizerEndsOn: plus(4) });
      expect((await receive("mom", id, { outsideDays: 20, dryRun: true })).json).toMatchObject({ dryRun: true, needsConfirmation: true });
      expect((await stored(id))!.revision).toBe(1);
      const ok = await receive("mom", id, { outsideDays: 20, confirmedTotalDays: 35 });
      expect(ok.json.supply).toMatchObject({ runsOutOn: plus(35), organizerDaysCounted: 5, outsideDays: 30 });
    });

    it("refuses a total beyond ten years", async () => {
      const id = await makeMed();
      await fill(id, today(), plus(30));
      const res = await receive("mom", id, { outsideDays: 3650 });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("supply_too_large");
    });
  });

  describe("repeated and concurrent submissions", () => {
    it("treats asking again as a no-op that says so", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      const first = await request("mom", id);
      const again = await request("writer", id);
      expect(again.json.alreadyRequested).toBe(true);
      expect(again.json.supply.requestedAt).toBe(first.json.supply.requestedAt);
      expect(again.json.supply.version).toBe(first.json.supply.version);
      expect(await events(id)).toHaveLength(1);
      expect((await stored(id))!.requestedByUserId).toBe(people.mom!.userId);
    });

    it("answers a repeated receipt with the saved result when it carries the same key", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      const key = randomUUID();
      const first = await receive("mom", id, { outsideDays: 30, idempotencyKey: key });
      const again = await receive("mom", id, { outsideDays: 30, idempotencyKey: key });
      expect(again.status).toBe(200);
      expect(again.json.replayed).toBe(true);
      expect(again.json.supply).toEqual(first.json.supply);
      expect(await revisions(id)).toHaveLength(1);
      expect((await events(id)).filter((e) => e.kind === "received")).toHaveLength(1);
    });

    it("applies one receipt when the same submission arrives twice at once", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      const key = randomUUID();
      const results = await Promise.all([1, 2, 3].map(() => receive("mom", id, { outsideDays: 30, idempotencyKey: key })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(results.filter((r) => r.json.replayed === true)).toHaveLength(2);
      expect(await revisions(id)).toHaveLength(1);
      expect((await events(id)).filter((e) => e.kind === "received")).toHaveLength(1);
      expect((await stored(id))!.revision).toBe(2);
    });

    it("waits for the row, so a submission another request is finishing is replayed, not applied twice", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      const key = randomUUID();
      let locked!: () => void;
      let release!: () => void;
      const hasLock = new Promise<void>((r) => (locked = r));
      const go = new Promise<void>((r) => (release = r));
      // Another request holds the row and, before it commits, records the very same submission.
      const holder = withHouseholdContext(baseDb, hhId, async (tx) => {
        await tx.execute(sql`select 1 from health_medication_supply where medication_id = ${id} for update`);
        locked();
        await go;
        await tx
          .update(healthMedicationSupply)
          .set({ lastWriteKey: key, runsOutOn: plus(30), revision: 2, version: 2 })
          .where(eq(healthMedicationSupply.medicationId, id));
        await tx.insert(healthMedicationSupplyRevisions).values({ medicationId: id, revision: 2, source: "receipt", runsOutOn: plus(30), estimatedOn: today(), outsideDays: 30, organizerDaysCounted: 0 });
      });
      await hasLock;
      const pending = receive("mom", id, { outsideDays: 30, idempotencyKey: key });
      await new Promise((r) => setTimeout(r, 400));
      release();
      await holder;
      const res = await pending;
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.replayed).toBe(true);
      expect((await stored(id))!.revision).toBe(2);
      expect(await revisions(id)).toHaveLength(1);
    });

    it("checks the version when one is sent", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      const stale = await receive("mom", id, { outsideDays: 30, version: 9 });
      expect(stale.status).toBe(409);
      expect(stale.json.error).toBe("version_conflict");
      expect(stale.json.supply.version).toBe(1);
      expect((await receive("mom", id, { outsideDays: 30, version: 1 })).status).toBe(200);
    });

    it("records one request when several people ask at once", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      const results = await Promise.all([request("mom", id), request("writer", id), request("mom", id), request("writer", id)]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.json.alreadyRequested === false)).toHaveLength(1);
      expect(await events(id)).toHaveLength(1);
      expect((await stored(id))!.version).toBe(2);
    });

    it("keeps a request and a receipt that race consistent", async () => {
      for (let i = 0; i < 3; i++) {
        const id = await makeMed();
        await withEstimate(id, 2);
        const [a, b] = await Promise.all([request("mom", id), receive("writer", id, { outsideDays: 30 })]);
        expect([a.status, b.status]).toEqual([200, 200]);
        const row = (await stored(id))!;
        // both took effect, in some order: two version bumps, one event of each kind, one receipt revision
        expect(row.version).toBe(3);
        expect(row.revision).toBe(2);
        const evs = await events(id);
        expect(evs.map((e) => e.kind).sort()).toEqual(["received", "requested"]);
        expect((await revisions(id)).map((r) => r.source)).toEqual(["receipt"]);
        // an open request may only be one made after the receipt; the receipt must never leave an older one open
        if (row.requestedAt !== null) expect(row.requestedAt.getTime()).toBeGreaterThanOrEqual(row.receivedAt!.getTime());
      }
    });

    it("applies two concurrent receipts one after the other", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      const results = await Promise.all([receive("mom", id, { outsideDays: 20 }), receive("writer", id, { outsideDays: 40 })]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const row = (await stored(id))!;
      expect(row.revision).toBe(3);
      expect((await revisions(id)).map((r) => r.revision)).toEqual([2, 3]);
      expect([plus(20), plus(40)]).toContain(row.runsOutOn);
    });
  });

  describe("paused and deleted medications", () => {
    it("refuses to request or receive for a paused medication, and 404s a deleted one", async () => {
      const paused = await makeMed({ enabled: false });
      await withEstimate(paused, 2);
      for (const res of [await request("mom", paused), await receive("mom", paused, { outsideDays: 30 })]) {
        expect(res.status).toBe(409);
        expect(res.json.error).toBe("medication_inactive");
      }
      expect((await stored(paused))!.requestedAt).toBeNull();

      const gone = await makeMed({ deletedAt: new Date() });
      expect((await request("mom", gone)).status).toBe(404);
      expect((await receive("mom", gone, { outsideDays: 30 })).status).toBe(404);
    });

    it("leaves paused and deleted medications off the list, and returns a resumed one", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      await call("mom", "PATCH", `/health/medications/${id}`, { enabled: false });
      expect((await refills("mom")).groups.flatMap((g: Json) => g.medications.map((m: Json) => m.id))).not.toContain(id);
      expect((await refills("mom", "?all=true")).groups.flatMap((g: Json) => g.medications.map((m: Json) => m.id))).not.toContain(id);
      await call("mom", "PATCH", `/health/medications/${id}`, { enabled: true });
      expect((await refills("mom")).groups.flatMap((g: Json) => g.medications.map((m: Json) => m.id))).toContain(id);
    });
  });

  describe("the list", () => {
    it("groups by pharmacy, soonest deadline first, with the medications that have none last", async () => {
      const marker2 = `${marker}-grp`;
      const [a, b] = [await pharmacy(`${marker2} A`), await pharmacy(`${marker2} B`)];
      const m1 = await makeMed({ name: `${marker2} m1` }); // deadline yesterday
      const m2 = await makeMed({ name: `${marker2} m2` }); // deadline today
      const m3 = await makeMed({ name: `${marker2} m3` }); // on B, requested, deadline in 2 days
      const m4 = await makeMed({ name: `${marker2} m4` }); // no pharmacy, overdue
      const m5 = await makeMed({ name: `${marker2} m5` }); // plenty left: only with all=true
      const m6 = await makeMed({ name: `${marker2} m6` }); // never estimated: only with all=true
      await withEstimate(m1, 6, { pharmacyId: a });
      await withEstimate(m2, 7, { pharmacyId: a });
      await withEstimate(m3, 9, { pharmacyId: b, requestedAt: new Date() });
      await withEstimate(m4, 1);
      await withEstimate(m5, 80, { pharmacyId: b });
      await withHouseholdContext(baseDb, hhId, (tx) => tx.insert(healthMedicationSupply).values({ medicationId: m6, pharmacyId: b }));

      const mine = (groups: Json[]) =>
        groups
          .map((g) => ({ pharmacy: g.pharmacy?.name ?? null, meds: g.medications.map((m: Json) => m.name).filter((n: string) => n.startsWith(marker2)) }))
          .filter((g) => g.meds.length > 0);

      const body = await refills("mom");
      expect(mine(body.groups)).toEqual([
        { pharmacy: `${marker2} A`, meds: [`${marker2} m1`, `${marker2} m2`] },
        { pharmacy: `${marker2} B`, meds: [`${marker2} m3`] },
        { pharmacy: null, meds: [`${marker2} m4`] },
      ]);
      expect(body.today).toBe(today());
      const everything = mine((await refills("mom", "?all=true")).groups);
      expect(everything.find((g) => g.pharmacy === `${marker2} B`)!.meds).toEqual([`${marker2} m3`, `${marker2} m5`, `${marker2} m6`]);
    });

    it("filters by person and ignores a bad filter", async () => {
      const mine = await makeMed({}, "ally");
      const theirs = await makeMed({}, "ben");
      await withEstimate(mine, 1);
      await withEstimate(theirs, 1);
      const ids = (body: Json) => body.groups.flatMap((g: Json) => g.medications.map((m: Json) => m.id));
      const onlyBen = ids(await refills("mom", `?memberId=${people.ben!.memberId}`));
      expect(onlyBen).toContain(theirs);
      expect(onlyBen).not.toContain(mine);
      expect((await refills("mom", "?memberId=nope")).groups).toEqual([]);
    });

    it("shows each person only the medications they may already see", async () => {
      const hidden = await makeMed({ visibility: "private" }, "mom", "mom");
      const shared = await makeMed({}, "mom", "mom");
      await withEstimate(hidden, 1);
      await withEstimate(shared, 1);
      const ids = async (as: string) => (await refills(as)).groups.flatMap((g: Json) => g.medications.map((m: Json) => m.id));
      expect(await ids("mom")).toEqual(expect.arrayContaining([hidden, shared]));
      for (const as of ["reader", "writer"]) {
        const seen = await ids(as);
        expect(seen, as).toContain(shared);
        expect(seen, as).not.toContain(hidden);
      }
      expect((await refills("outsider")).groups).toEqual([]);
    });

    it("tells each viewer whether they can act on a medication", async () => {
      const id = await makeMed();
      await withEstimate(id, 1);
      const canEdit = async (as: string) => (await refills(as)).groups.flatMap((g: Json) => g.medications).find((m: Json) => m.id === id).canEdit;
      expect(await canEdit("mom")).toBe(true);
      expect(await canEdit("writer")).toBe(true);
      expect(await canEdit("reader")).toBe(false);
    });
  });

  describe("who may act", () => {
    it("lets a reader look but not request or receive", async () => {
      const id = await makeMed();
      await withEstimate(id, 1);
      expect((await refills("reader")).groups.flatMap((g: Json) => g.medications.map((m: Json) => m.id))).toContain(id);
      expect((await request("reader", id)).status).toBe(403);
      expect((await receive("reader", id, { outsideDays: 30 })).status).toBe(403);
      const row = (await stored(id))!;
      expect(row).toMatchObject({ requestedAt: null, revision: 1 });
      expect(await events(id)).toHaveLength(0);
    });

    it("stops a writer whose access is revoked", async () => {
      const id = await makeMed();
      await withEstimate(id, 1);
      expect((await request("writer", id)).status).toBe(200);
      await withHouseholdContext(baseDb, hhId, (tx) =>
        tx.delete(healthMemberAcl).where(and(eq(healthMemberAcl.subjectMemberId, people.ally!.memberId), eq(healthMemberAcl.granteeMemberId, people.writer!.memberId))),
      );
      try {
        expect((await receive("writer", id, { outsideDays: 30 })).status).toBe(403);
        expect((await request("writer", await makeMed())).status).toBe(403);
      } finally {
        await withHouseholdContext(baseDb, hhId, (tx) =>
          tx.insert(healthMemberAcl).values({ householdId: hhId, subjectMemberId: people.ally!.memberId, granteeMemberId: people.writer!.memberId, medicationsAccess: "write" }),
        );
      }
      expect((await stored(id))!.revision).toBe(1);
    });

    it("does not reveal a private medication or another household's", async () => {
      const hidden = await makeMed({ visibility: "private" }, "mom", "mom");
      expect((await request("writer", hidden)).status).toBe(404);
      expect((await receive("reader", hidden, { outsideDays: 5 })).status).toBe(404);
      const id = await makeMed();
      expect((await request("outsider", id)).status).toBe(404);
      expect((await request("mom", randomUUID())).status).toBe(404);
      expect((await request("mom", "nope")).status).toBe(404);
    });
  });

  describe("input", () => {
    it("refuses bad receipts with a code and writes nothing", async () => {
      const id = await makeMed();
      await withEstimate(id, 2);
      const bad: Array<[unknown, string]> = [
        [{}, "invalid_outside_days"],
        [{ outsideDays: -1 }, "invalid_outside_days"],
        [{ outsideDays: 2.5 }, "invalid_outside_days"],
        [{ outsideDays: "9" }, "invalid_outside_days"],
        [{ outsideDays: 3651 }, "invalid_outside_days"],
        [{ outsideDays: 5, confirmedTotalDays: -1 }, "invalid_confirmed_total"],
        [{ outsideDays: 5, version: 0 }, "invalid_version"],
        [{ outsideDays: 5, idempotencyKey: "" }, "invalid_idempotency_key"],
        [{ outsideDays: 5, dryRun: 1 }, "invalid_body"],
        [[], "invalid_body"],
      ];
      for (const [body, code] of bad) {
        const res = await receive("mom", id, body as Record<string, unknown>);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.json.error, JSON.stringify(body)).toBe(code);
      }
      const raw = await app.request(`/health/medications/${id}/supply/receive`, { method: "POST", headers: { "x-as": "mom", "content-type": "application/json" }, body: "nope" });
      expect(raw.status).toBe(400);
      expect(await revisions(id)).toHaveLength(0);
      expect((await stored(id))!.revision).toBe(1);
    });
  });
});
