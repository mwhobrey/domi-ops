import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { addDaysUtc, todayIsoDateInTz } from "@domi-ops/calendar-sync";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthMedicationDoseQuantities,
  healthMedicationLogs,
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
  healthMemberAcl,
  healthOrganizerSessionFills,
  healthOrganizerSessions,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  type Database,
} from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { createTenantMiddleware } from "../middleware/tenant.js";
import { healthOrganizerRoutes } from "./health-organizers.js";
import { healthOrganizerAppointmentRoutes } from "./health-organizer-appointments.js";
import { healthOrganizerSessionRoutes } from "./health-organizer-sessions.js";

/**
 * WHO-426: filling sessions against a real Postgres as the app role. Auth is faked by a parent app from the
 * `x-as` header; the tenant middleware and everything below it are the real code. The household clock is UTC and
 * "today" is the real clock, so every date below is relative to it. Skipped without a database.
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

type MedSpec = { times: string[]; q: Record<string, number>; over?: Partial<typeof healthMedications.$inferInsert> };

maybeDescribe("filling sessions (integration)", () => {
  const marker = `who426-${Date.now()}`;
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
        const [u] = await tx.insert(users).values({ email: `who426-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true }).returning({ id: users.id });
        userIds.push(u.id);
        const [row] = await tx.insert(householdMembers).values({ householdId: hh.id, userId: u.id, role: m.role, name: m.key }).returning({ id: householdMembers.id });
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
  const inDb = <T>(fn: (tx: Database) => Promise<T>) => withHouseholdContext(baseDb, hhId, fn);

  const TIME_TO_COMPARTMENT: Record<string, number> = { "08:00": 0, "12:00": 1, "18:00": 2, "21:00": 3 };

  /** A new child with a plan (four compartments, times mapped morning/lunch/supper/night) and medications with pill quantities. */
  async function setup(meds: MedSpec[] = [{ times: ["08:00", "21:00"], q: { "08:00": 4, "21:00": 2 } }, { times: ["12:00"], q: { "12:00": 8 } }]) {
    const kid = `kid-${randomUUID().slice(0, 6)}`;
    await withSystemContext(baseDb, async (tx) => {
      const [u] = await tx.insert(users).values({ email: `who426-${randomUUID()}@test.local`, displayName: kid, emailVerified: true }).returning({ id: users.id });
      userIds.push(u.id);
      const [row] = await tx.insert(householdMembers).values({ householdId: hhId, userId: u.id, role: "child", name: kid }).returning({ id: householdMembers.id });
      people[kid] = { userId: u.id, memberId: row.id, householdId: hhId, role: "child" };
    });
    await inDb((tx) =>
      tx.insert(healthMemberAcl).values([
        { householdId: hhId, subjectMemberId: people[kid]!.memberId, granteeMemberId: people.reader!.memberId, medicationsAccess: "read" },
        { householdId: hhId, subjectMemberId: people[kid]!.memberId, granteeMemberId: people.writer!.memberId, medicationsAccess: "write" },
        { householdId: hhId, subjectMemberId: people[kid]!.memberId, granteeMemberId: people.writer2!.memberId, medicationsAccess: "write" },
      ]),
    );
    const medIds: string[] = [];
    for (const spec of meds) {
      const id = await inDb(async (tx) => {
        const [m] = await tx
          .insert(healthMedications)
          .values({
            householdId: hhId,
            memberId: people[kid]!.memberId,
            name: `${marker} ${randomUUID().slice(0, 6)}`,
            dosage: "10 mg",
            instructions: "with food",
            scheduleKind: "scheduled",
            scheduleJson: JSON.stringify({ times: spec.times }),
            visibility: "household",
            createdByUserId: people.mom!.userId,
            ...spec.over,
          })
          .returning({ id: healthMedications.id });
        for (const [time, quarters] of Object.entries(spec.q)) {
          await tx.insert(healthMedicationDoseQuantities).values({ medicationId: m.id, doseTime: time, quantityQuarters: quarters });
        }
        return m.id;
      });
      medIds.push(id);
    }
    const created = await call("mom", "POST", "/", { memberId: people[kid]!.memberId, scheduleKind: "every_n_days", everyN: 30, anchorDate: today() });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const compartments = created.json.plan.compartments as Array<{ id: string; name: string }>;
    const timeMap: Record<string, string> = {};
    for (const spec of meds) for (const t of spec.times) timeMap[t] = compartments[TIME_TO_COMPARTMENT[t] ?? 0]!.id;
    const mapped = await call("mom", "PATCH", `/${created.json.plan.id}`, { version: created.json.plan.version, timeMap });
    expect(mapped.status, JSON.stringify(mapped.json)).toBe(200);
    return { kid, plan: mapped.json.plan as Json, medIds, compartments };
  }

  const start = (as: string, plan: Json, body: Record<string, unknown> = {}) => call(as, "POST", `/${plan.id}/sessions`, body);
  async function begin(plan: Json, body: Record<string, unknown> = {}): Promise<Json> {
    const res = await start("mom", plan, body);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json.session;
  }
  const getSession = (as: string, plan: Json, id: string) => call(as, "GET", `/${plan.id}/sessions/${id}`);
  const fill = (as: string, plan: Json, session: Json, medicationId: string, body: Record<string, unknown> = {}) =>
    call(as, "POST", `/${plan.id}/sessions/${session.id}/fills`, {
      medicationId,
      coveredFrom: session.coverageStart,
      coveredTo: session.coverageEnd,
      outsideDays: 10,
      idempotencyKey: randomUUID(),
      version: session.version,
      ...body,
    });
  async function fillOk(plan: Json, session: Json, medicationId: string, body: Record<string, unknown> = {}): Promise<Json> {
    const res = await fill("mom", plan, session, medicationId, body);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json;
  }
  const act = (as: string, plan: Json, session: Json, what: string, body: Record<string, unknown> = {}) =>
    call(as, "POST", `/${plan.id}/sessions/${session.id}/${what}`, { version: session.version, ...body });
  const med = (session: Json, id: string): Json => session.medications.find((m: Json) => m.medicationId === id);
  const fillRows = (sessionId: string) =>
    inDb((tx) => tx.select().from(healthOrganizerSessionFills).where(eq(healthOrganizerSessionFills.sessionId, sessionId)).orderBy(asc(healthOrganizerSessionFills.createdAt)));
  const revisions = (medicationId: string) =>
    inDb((tx) => tx.select().from(healthMedicationSupplyRevisions).where(eq(healthMedicationSupplyRevisions.medicationId, medicationId)).orderBy(asc(healthMedicationSupplyRevisions.revision)));
  const supplyRow = async (medicationId: string) =>
    (await inDb((tx) => tx.select().from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, medicationId))))[0];
  const sessionRow = async (id: string) => (await inDb((tx) => tx.select().from(healthOrganizerSessions).where(eq(healthOrganizerSessions.id, id))))[0]!;

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    hhId = await seedHousehold(`${marker}-home`, [
      { key: "mom", role: "owner" },
      { key: "dad", role: "admin" },
      { key: "reader", role: "member" },
      { key: "writer", role: "member" },
      { key: "writer2", role: "member" },
      { key: "stranger", role: "member" },
    ]);
    await seedHousehold(`${marker}-other`, [{ key: "outsider", role: "owner" }]);

    const scoped = createScopedDb(baseDb);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      const who = people[c.req.header("x-as") ?? ""];
      c.set("userId", who?.userId ?? null);
      c.set(
        "auth",
        who ? { userId: who.userId, householdId: who.householdId, memberId: who.memberId, email: null, username: null, name: null, role: who.role } : null,
      );
      return next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.route("/", healthOrganizerRoutes(scoped, env));
    app.route("/", healthOrganizerAppointmentRoutes(scoped, env));
    app.route("/", healthOrganizerSessionRoutes(scoped, env));
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("starting a session", () => {
    it("takes the snapshot: compartments, what goes in each, and how many pills", async () => {
      const { plan, medIds, compartments } = await setup();
      const res = await start("mom", plan);
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      const s = res.json.session;
      expect(res.json.existing).toBe(false);
      expect(s).toMatchObject({
        status: "open",
        version: 1,
        coverageStart: today(),
        coverageEnd: plus(30),
        fillLengthDays: 31,
        occurrenceDate: null,
        reviewRequired: false,
        changes: null,
        progress: { total: 2, filled: 0, partial: 0, pending: 2 },
        fills: [],
      });
      expect(s.compartments.map((c: Json) => c.name)).toEqual(["Morning", "Lunch", "Supper", "Night"]);
      const a = med(s, medIds[0]!);
      expect(a).toMatchObject({ dosage: "10 mg", instructions: "with food", status: "pending", requiredDays: 31, filledDays: 0, totalPills: 31 * 1.5, lastFill: null });
      expect(a.byCompartment).toEqual([{ compartmentId: compartments[0]!.id, pills: 31 }, { compartmentId: compartments[3]!.id, pills: 15.5 }]);
      expect(a.placements).toHaveLength(62);
      expect(a.placements[0]).toEqual({ date: today(), time: "08:00", compartmentId: compartments[0]!.id, pills: 1 });
      expect(med(s, medIds[1]!)).toMatchObject({ totalPills: 62, byCompartment: [{ compartmentId: compartments[1]!.id, pills: 62 }] });
    });

    it("keeps the snapshot encrypted", async () => {
      const { plan } = await setup();
      const s = await begin(plan);
      const row = await sessionRow(s.id);
      expect(row.snapshotJson).toMatch(/^enc:v1:/);
      expect(row.snapshotJson).not.toContain(s.medications[0].name);
      expect(row.snapshotHash).toMatch(/^[0-9a-f]{16,}$/);
    });

    it("answers with the open session when there already is one, even when several are started at once", async () => {
      const { plan } = await setup();
      const results = await Promise.all([1, 2, 3, 4].map((i) => start(i % 2 ? "mom" : "writer", plan)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const others = results.filter((r) => r.status === 200);
      expect(others).toHaveLength(3);
      for (const r of others) expect(r.json.existing).toBe(true);
      const ids = new Set(results.map((r) => r.json.session.id));
      expect(ids.size).toBe(1);
      const rows = await inDb((tx) => tx.select().from(healthOrganizerSessions).where(eq(healthOrganizerSessions.planId, plan.id)));
      expect(rows).toHaveLength(1);
    });

    it("ignores the fills of a medication that has been deleted when choosing the start day", async () => {
      const { plan, medIds } = await setup();
      const holder = await inDb(async (tx) => {
        const [h] = await tx
          .insert(healthOrganizerSessions)
          .values({ planId: plan.id, coverageStart: today(), fillLengthDays: 31, snapshotJson: "{}", snapshotHash: "h", status: "abandoned", abandonedAt: new Date() })
          .returning({ id: healthOrganizerSessions.id });
        return h.id;
      });
      await inDb((tx) => tx.update(healthMedications).set({ deletedAt: new Date() }).where(eq(healthMedications.id, medIds[1]!)));
      await inDb((tx) => tx.insert(healthOrganizerSessionFills).values({ sessionId: holder, medicationId: medIds[1]!, coveredFrom: today(), coveredTo: plus(100), idempotencyKey: "deleted" }));
      expect((await call("mom", "GET", `/${plan.id}/sessions/defaults`)).json.coverageStart).toBe(today());
    });

    it("lets the start day and length be chosen", async () => {
      const { plan } = await setup();
      const s = await begin(plan, { coverageStart: plus(5), fillLengthDays: 14 });
      expect(s).toMatchObject({ coverageStart: plus(5), coverageEnd: plus(18), fillLengthDays: 14 });
      expect(s.medications[0].requiredDays).toBe(14);
    });

    it("refuses a start day or length that makes no sense", async () => {
      const { plan } = await setup();
      for (const [body, code] of [
        [{ coverageStart: "soon" }, "invalid_coverage_start"],
        [{ coverageStart: plus(-40) }, "invalid_coverage_start"],
        [{ coverageStart: plus(400) }, "invalid_coverage_start"],
        [{ fillLengthDays: 0 }, "invalid_fill_length"],
        [{ fillLengthDays: 94 }, "invalid_fill_length"],
      ] as Array<[Record<string, unknown>, string]>) {
        const res = await start("mom", plan, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.json.error, JSON.stringify(body)).toBe(code);
      }
      expect((await call("mom", "GET", `/${plan.id}/sessions/current`)).json.session).toBeNull();
    });

    it("says where it would start and how long it would be, and picks up after what is already filled", async () => {
      const { plan, medIds } = await setup();
      const d0 = await call("mom", "GET", `/${plan.id}/sessions/defaults`);
      expect(d0.json).toEqual({ today: today(), coverageStart: today(), fillLengthDays: 31, openSessionId: null });
      const s = await begin(plan);
      expect((await call("mom", "GET", `/${plan.id}/sessions/defaults`)).json.openSessionId).toBe(s.id);
      await fillOk(plan, s, medIds[0]!);
      await act("mom", plan, (await getSession("mom", plan, s.id)).json.session, "finish");
      const d1 = await call("mom", "GET", `/${plan.id}/sessions/defaults`);
      expect(d1.json).toMatchObject({ coverageStart: plus(31), openSessionId: null });
    });

    it("starts today again when what was filled has already run out", async () => {
      const { plan, medIds } = await setup();
      const holder = await inDb(async (tx) => {
        const [h] = await tx
          .insert(healthOrganizerSessions)
          .values({ planId: plan.id, coverageStart: plus(-60), fillLengthDays: 31, snapshotJson: "{}", snapshotHash: "h", status: "abandoned", abandonedAt: new Date() })
          .returning({ id: healthOrganizerSessions.id });
        return h.id;
      });
      await inDb((tx) => tx.insert(healthOrganizerSessionFills).values({ sessionId: holder, medicationId: medIds[0]!, coveredFrom: plus(-60), coveredTo: plus(-30), idempotencyKey: "old" }));
      expect((await call("mom", "GET", `/${plan.id}/sessions/defaults`)).json.coverageStart).toBe(today());
    });

    it("is refused until every dose has a compartment and a pill quantity", async () => {
      const { plan, medIds } = await setup([{ times: ["08:00", "21:00"], q: { "08:00": 4 } }]);
      const res = await start("mom", plan);
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("setup_incomplete");
      expect(res.json.problems).toEqual([{ kind: "missing_quantity", severity: "error", medicationId: medIds[0], time: "21:00" }]);
      expect((await call("mom", "GET", `/${plan.id}/sessions/current`)).json.session).toBeNull();
    });

    it("does not tell someone a problem with a medication they cannot see", async () => {
      const { plan } = await setup([
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: ["13:00"], q: {}, over: { visibility: "private" } },
      ]);
      const asMom = await start("mom", plan);
      expect(asMom.json.error).toBe("setup_incomplete");
      expect(asMom.json.problems.length).toBeGreaterThan(0);
      const asAdmin = await start("dad", plan);
      expect(asAdmin.status).toBe(409);
      expect(asAdmin.json).toEqual({ error: "setup_incomplete", problems: [] });
    });

    it("names only the visible medications when one problem covers a visible and a hidden one", async () => {
      // both medications are taken at 13:00, a time with no compartment: one problem, naming both
      const { plan, medIds } = await setup([
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: ["13:00"], q: { "13:00": 4 } },
        { times: ["13:00"], q: { "13:00": 4 }, over: { visibility: "private" } },
      ]);
      // take 13:00 out of the mapping, so it has no compartment
      const unmapped = await call("mom", "PATCH", `/${plan.id}`, { version: plan.version, timeMap: { "08:00": plan.compartments[0].id } });
      expect(unmapped.status, JSON.stringify(unmapped.json)).toBe(200);
      const asMom = await start("mom", plan);
      expect(asMom.json.problems).toEqual([{ kind: "unmapped_time", severity: "error", time: "13:00", medicationIds: [medIds[1], medIds[2]].sort() }]);
      const asAdmin = await start("dad", plan);
      expect(asAdmin.json.problems).toEqual([{ kind: "unmapped_time", severity: "error", time: "13:00", medicationIds: [medIds[1]] }]);
      expect(JSON.stringify(asAdmin.json)).not.toContain(medIds[2]!);
    });

    it("answers with the session another request started a moment earlier, not an error", async () => {
      const { plan } = await setup();
      // a real snapshot to stand in for the one the other request would have taken
      const donor = await setup();
      const donorRow = await sessionRow((await begin(donor.plan)).id);
      let inserted!: () => void;
      let release!: () => void;
      const hasInserted = new Promise<void>((r) => (inserted = r));
      const go = new Promise<void>((r) => (release = r));
      // Another request has started a session but not committed, so this one cannot see it yet.
      const holder = inDb(async (tx) => {
        await tx
          .insert(healthOrganizerSessions)
          .values({ planId: plan.id, coverageStart: today(), fillLengthDays: 31, snapshotJson: donorRow.snapshotJson, snapshotHash: donorRow.snapshotHash });
        inserted();
        await go;
      });
      await hasInserted;
      const pending = start("mom", plan);
      // wait until the request is really stuck behind the uncommitted session (a lock nobody has been granted), not for a guessed time
      for (let i = 0; i < 100; i++) {
        const [row] = await baseDb.execute(sql`select count(*)::int as n from pg_locks where not granted and locktype = 'transactionid'`);
        if (Number((row as { n: number }).n) > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      release();
      await holder;
      const res = await pending;
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.existing).toBe(true);
      expect(await inDb((tx) => tx.select().from(healthOrganizerSessions).where(eq(healthOrganizerSessions.planId, plan.id)))).toHaveLength(1);
    });

    it("is refused when there is nothing to fill", async () => {
      const { plan } = await setup([{ times: ["08:00"], q: { "08:00": 4 }, over: { scheduleKind: "prn", scheduleJson: "{}" } }]);
      const res = await start("mom", plan);
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("nothing_to_fill");
    });

    it("can be started from an appointment, which it finishes", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan, { occurrenceDate: today() });
      expect(s.occurrenceDate).toBe(today());
      const [appt] = (await call("mom", "GET", `/${plan.id}/appointments?from=${today()}&to=${today()}`)).json.appointments;
      expect(appt.status).toBe("today");
      await fillOk(plan, s, medIds[0]!);
      await act("mom", plan, (await getSession("mom", plan, s.id)).json.session, "finish");
      expect((await call("mom", "GET", `/${plan.id}/appointments/${today()}`)).json.appointment).toMatchObject({ status: "done", doneBy: "session" });
    });

    it("refuses an appointment day the schedule does not have", async () => {
      const { plan } = await setup();
      for (const date of [plus(1), "soon"]) {
        const res = await start("mom", plan, { occurrenceDate: date });
        expect(res.status, date).toBe(404);
        expect(res.json.error, date).toBe("appointment_not_found");
      }
    });

    it("stops at sixty sessions for a person", async () => {
      const { plan } = await setup();
      await inDb((tx) =>
        tx.insert(healthOrganizerSessions).values(
          Array.from({ length: 60 }, (_, i) => ({
            planId: plan.id,
            coverageStart: plus(-100 - i),
            fillLengthDays: 31,
            snapshotJson: "{}",
            snapshotHash: "h",
            status: "abandoned" as const,
            abandonedAt: new Date(),
          })),
        ),
      );
      const res = await start("mom", plan);
      expect(res.status).toBe(409);
      expect(res.json).toEqual({ error: "too_many_sessions", max: 60 });
    });
  });

  describe("reading a session", () => {
    it("is the same session on another device, and lists recent ones", async () => {
      const { plan } = await setup();
      const s = await begin(plan);
      const current = await call("writer", "GET", `/${plan.id}/sessions/current`);
      expect(current.json.session.id).toBe(s.id);
      expect((await getSession("reader", plan, s.id)).json.session.id).toBe(s.id);
      const list = await call("mom", "GET", `/${plan.id}/sessions`);
      expect(list.json.sessions).toHaveLength(1);
      expect(list.json.sessions[0]).toMatchObject({ id: s.id, status: "open", version: 1, coverageStart: today(), coverageEnd: plus(30) });
    });

    it("answers 404 for an unknown session or plan", async () => {
      const { plan } = await setup();
      expect((await getSession("mom", plan, randomUUID())).status).toBe(404);
      expect((await getSession("mom", plan, "nope")).status).toBe(404);
      expect((await call("mom", "GET", `/${randomUUID()}/sessions/current`)).status).toBe(404);
    });

    it("does not list a hidden as-needed medication among those not guided", async () => {
      const { plan, medIds } = await setup([
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: [], q: {}, over: { scheduleKind: "prn", scheduleJson: "{}", visibility: "private" } },
        { times: [], q: {}, over: { scheduleKind: "prn", scheduleJson: "{}" } },
      ]);
      const s = await begin(plan);
      expect(s.notGuided.map((n: Json) => n.medicationId).sort()).toEqual([medIds[1], medIds[2]].sort());
      const seen = (await getSession("dad", plan, s.id)).json.session;
      expect(seen.notGuided).toEqual([{ medicationId: medIds[2], reason: "as_needed" }]);
    });

    it("leaves out medications the viewer cannot see, and their progress", async () => {
      const { plan, medIds } = await setup([
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: ["12:00"], q: { "12:00": 4 }, over: { visibility: "private" } },
      ]);
      const s = await begin(plan);
      expect(s.medications.map((m: Json) => m.medicationId).sort()).toEqual([...medIds].sort());
      const seen = (await getSession("dad", plan, s.id)).json.session;
      expect(seen.medications.map((m: Json) => m.medicationId)).toEqual([medIds[0]]);
      expect(seen.progress.total).toBe(1);
      expect(JSON.stringify(seen)).not.toContain(medIds[1]!);
    });
  });

  describe("recording a fill", () => {
    it("records the days filled and the supply it leaves, in one step", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const res = await fill("mom", plan, s, medIds[0]!, { outsideDays: 10 });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.replayed).toBe(false);
      expect(res.json.fill).toMatchObject({ medicationId: medIds[0], coveredFrom: today(), coveredTo: plus(30), outsideDays: 10, supplyRevision: 1, undoneAt: null });
      expect(res.json.supply).toMatchObject({ runsOutOn: plus(41), organizerDays: 31, outsideDays: 10, revision: 1 });
      expect(res.json.session).toMatchObject({ version: 2, progress: { total: 2, filled: 1, pending: 1 } });
      expect(med(res.json.session, medIds[0]!)).toMatchObject({ status: "filled", filledDays: 31, covered: [{ from: today(), to: plus(30) }], missing: [], lastFill: { id: res.json.fill.id } });

      expect(await supplyRow(medIds[0]!)).toMatchObject({ runsOutOn: plus(41), outsideDays: 10, organizerDaysCounted: 31, revision: 1, estimatedOn: today() });
      expect(await revisions(medIds[0]!)).toMatchObject([{ revision: 1, source: "fill", sessionId: s.id, runsOutOn: plus(41), createdByUserId: people.mom!.userId }]);
    });

    it("records a repeat of the same fill once, and answers it with the first result", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const key = randomUUID();
      const first = await fill("mom", plan, s, medIds[0]!, { idempotencyKey: key });
      const again = await fill("mom", plan, s, medIds[0]!, { idempotencyKey: key });
      expect(again.status).toBe(200);
      expect(again.json.replayed).toBe(true);
      expect(again.json.fill.id).toBe(first.json.fill.id);
      // still true from a stale version, and after the session has moved on
      await fillOk(plan, first.json.session, medIds[1]!);
      const late = await fill("writer", plan, s, medIds[0]!, { idempotencyKey: key });
      expect(late.json).toMatchObject({ replayed: true, fill: { id: first.json.fill.id } });
      expect(await fillRows(s.id)).toHaveLength(2);
      expect(await revisions(medIds[0]!)).toHaveLength(1);
    });

    it("refuses a key reused for a different fill", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const key = randomUUID();
      await fill("mom", plan, s, medIds[0]!, { idempotencyKey: key });
      const other = await fill("mom", plan, s, medIds[0]!, { idempotencyKey: key, coveredTo: plus(20) });
      expect(other.status).toBe(409);
      expect(other.json.error).toBe("idempotency_key_reused");
      expect(await fillRows(s.id)).toHaveLength(1);
    });

    it("sends two identical requests at once and records one", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const key = randomUUID();
      const results = await Promise.all([1, 2, 3].map((i) => fill(i % 2 ? "mom" : "writer", plan, s, medIds[0]!, { idempotencyKey: key })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(results.filter((r) => r.json.replayed === false)).toHaveLength(1);
      expect(await fillRows(s.id)).toHaveLength(1);
      expect(await revisions(medIds[0]!)).toHaveLength(1);
    });

    it("refuses a stale version with the current state, and records nothing", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      await fillOk(plan, s, medIds[0]!);
      const stale = await fill("writer", plan, s, medIds[1]!);
      expect(stale.status).toBe(409);
      expect(stale.json.error).toBe("version_conflict");
      expect(stale.json.session).toMatchObject({ version: 2, progress: { filled: 1 } });
      expect(await fillRows(s.id)).toHaveLength(1);
      expect(await supplyRow(medIds[1]!)).toBeUndefined();
      expect((await fill("writer", plan, stale.json.session, medIds[1]!)).status).toBe(200);
    });

    it("lets two caregivers fill different medications at once, one retrying with what the other left", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const [a, b] = await Promise.all([fill("writer", plan, s, medIds[0]!), fill("writer2", plan, s, medIds[1]!)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      const winner = a.status === 200 ? a : b;
      expect(loser.json.session.version).toBe(2);
      const retry = await fill(a.status === 409 ? "writer" : "writer2", plan, loser.json.session, a.status === 409 ? medIds[0]! : medIds[1]!);
      expect(retry.status, JSON.stringify(retry.json)).toBe(200);
      expect(retry.json.session).toMatchObject({ version: 3, progress: { filled: 2, pending: 0 } });
      expect(winner.json.fill.id).not.toBe(retry.json.fill.id);
      expect(await fillRows(s.id)).toHaveLength(2);
    });

    it("keeps a fill that waited behind another's change from being applied against an old version", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      let locked!: () => void;
      let release!: () => void;
      const hasLock = new Promise<void>((r) => (locked = r));
      const go = new Promise<void>((r) => (release = r));
      const holder = inDb(async (tx) => {
        await tx.execute(sql`select 1 from health_organizer_sessions where id = ${s.id} for update`);
        locked();
        await go;
        await tx.update(healthOrganizerSessions).set({ version: sql`${healthOrganizerSessions.version} + 1` }).where(eq(healthOrganizerSessions.id, s.id));
      });
      await hasLock;
      const pending = fill("mom", plan, s, medIds[0]!);
      await new Promise((r) => setTimeout(r, 400));
      release();
      await holder;
      expect((await pending).status).toBe(409);
      expect(await fillRows(s.id)).toHaveLength(0);
    });

    it("allows less than the whole stretch when supply is short, and says which days are missing", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const res = await fillOk(plan, s, medIds[0]!, { coveredTo: plus(19), outsideDays: 0 });
      expect(med(res.session, medIds[0]!)).toMatchObject({
        status: "partial",
        requiredDays: 31,
        filledDays: 20,
        covered: [{ from: today(), to: plus(19) }],
        missing: [{ from: plus(20), to: plus(30) }],
      });
      expect(res.supply).toMatchObject({ organizerDays: 20, outsideDays: 0, runsOutOn: plus(20) });
      expect(res.session.progress).toEqual({ total: 2, filled: 0, partial: 1, pending: 1 });
    });

    it("tops up in the same session when more arrives, and the estimate follows", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const first = await fillOk(plan, s, medIds[0]!, { coveredTo: plus(19), outsideDays: 0 });
      const top = await fillOk(plan, first.session, medIds[0]!, { coveredFrom: plus(20), coveredTo: plus(30), outsideDays: 5 });
      expect(med(top.session, medIds[0]!)).toMatchObject({ status: "filled", filledDays: 31, covered: [{ from: today(), to: plus(30) }], missing: [] });
      expect(top.supply).toMatchObject({ organizerDays: 31, outsideDays: 5, runsOutOn: plus(36), revision: 2 });
      expect((await revisions(medIds[0]!)).map((r) => [r.revision, r.runsOutOn])).toEqual([[1, plus(20)], [2, plus(36)]]);
    });

    it("tops up in a later session too", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const first = await fillOk(plan, s, medIds[0]!, { coveredTo: plus(14), outsideDays: 0 });
      await fillOk(plan, first.session, medIds[1]!);
      await act("mom", plan, (await getSession("mom", plan, s.id)).json.session, "finish");
      const next = await begin(plan, { coverageStart: plus(15), fillLengthDays: 16 });
      const top = await fillOk(plan, next, medIds[0]!, { coveredFrom: plus(15), coveredTo: plus(30), outsideDays: 3 });
      expect(top.supply).toMatchObject({ organizerDays: 31, runsOutOn: plus(34) });
    });

    it("merges overlapping coverage and counts each day once", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const first = await fillOk(plan, s, medIds[0]!, { coveredTo: plus(19), outsideDays: 0 });
      const second = await fillOk(plan, first.session, medIds[0]!, { coveredFrom: plus(10), coveredTo: plus(30), outsideDays: 0 });
      expect(med(second.session, medIds[0]!)).toMatchObject({ status: "filled", covered: [{ from: today(), to: plus(30) }] });
      expect(second.supply).toMatchObject({ organizerDays: 31, runsOutOn: plus(31) });
    });

    it("asks for the total on hand when the organizers would have a gap, and records nothing until it has it", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const first = await fillOk(plan, s, medIds[0]!, { coveredTo: plus(9), outsideDays: 0 });
      const gappy = await fill("mom", plan, first.session, medIds[0]!, { coveredFrom: plus(15), coveredTo: plus(25), outsideDays: 0 });
      expect(gappy.status).toBe(409);
      expect(gappy.json).toMatchObject({ error: "confirmation_required", organizerDays: 10, organizerEndsOn: plus(9) });
      expect(await fillRows(s.id)).toHaveLength(1);
      expect(await revisions(medIds[0]!)).toHaveLength(1);
      expect((await getSession("mom", plan, s.id)).json.session.version).toBe(2);
      const ok = await fill("mom", plan, first.session, medIds[0]!, { coveredFrom: plus(15), coveredTo: plus(25), outsideDays: 0, confirmedTotalDays: 21 });
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
      expect(ok.json.supply).toMatchObject({ organizerDays: 10, outsideDays: 11, runsOutOn: plus(21) });
    });

    it("previews the run-out date without recording anything or needing the version", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const preview = await fill("mom", plan, s, medIds[0]!, { dryRun: true, version: 1, outsideDays: 4 });
      expect(preview.status, JSON.stringify(preview.json)).toBe(200);
      expect(preview.json).toMatchObject({ dryRun: true, needsConfirmation: false, runsOutOn: plus(35), organizerDays: 31, outsideDays: 4, estimatedOn: today() });
      expect(preview.json.progressAfter).toMatchObject({ status: "filled", coveredCount: 31 });
      const staleButFine = await fill("mom", plan, s, medIds[0]!, { dryRun: true, version: 77 });
      expect(staleButFine.status).toBe(200);
      expect(await fillRows(s.id)).toHaveLength(0);
      expect(await supplyRow(medIds[0]!)).toBeUndefined();
      expect((await getSession("mom", plan, s.id)).json.session.version).toBe(1);
    });

    it("previews a gap as needing the total", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const first = await fillOk(plan, s, medIds[0]!, { coveredTo: plus(9), outsideDays: 0 });
      const preview = await fill("mom", plan, first.session, medIds[0]!, { dryRun: true, coveredFrom: plus(15), coveredTo: plus(25) });
      expect(preview.json).toMatchObject({ dryRun: true, needsConfirmation: true, organizerDays: 10 });
    });

    it("refuses days outside the session, a backwards range, more than ten years' supply, and bad input", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const bad: Array<[Record<string, unknown>, number, string]> = [
        [{ coveredFrom: plus(-1) }, 400, "range_outside_session"],
        [{ coveredTo: plus(31) }, 400, "range_outside_session"],
        [{ coveredFrom: plus(10), coveredTo: plus(5) }, 400, "invalid_range"],
        [{ coveredFrom: "soon" }, 400, "invalid_range"],
        [{ outsideDays: -1 }, 400, "invalid_outside_days"],
        [{ outsideDays: 3651 }, 400, "invalid_outside_days"],
        [{ outsideDays: 3650 }, 400, "supply_too_large"],
        [{ confirmedTotalDays: -3 }, 400, "invalid_confirmed_total"],
        [{ idempotencyKey: "" }, 400, "invalid_idempotency_key"],
        [{ idempotencyKey: "k".repeat(101) }, 400, "invalid_idempotency_key"],
        [{ version: 0 }, 400, "invalid_version"],
        [{ dryRun: "yes" }, 400, "invalid_body"],
        [{ medicationId: "nope" }, 404, "medication_not_found"],
        [{ medicationId: randomUUID() }, 404, "medication_not_found"],
      ];
      for (const [body, status, code] of bad) {
        const res = await fill("mom", plan, s, medIds[0]!, body);
        expect(res.status, JSON.stringify(body)).toBe(status);
        expect(res.json.error, JSON.stringify(body)).toBe(code);
      }
      expect((await call("mom", "POST", `/${plan.id}/sessions/${s.id}/fills`, "nope")).status).toBe(400);
      expect(await fillRows(s.id)).toHaveLength(0);
    });

    it("only takes medications in the session: another person's, as-needed, hidden ones", async () => {
      const { plan, medIds } = await setup([
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: ["12:00"], q: { "12:00": 4 }, over: { visibility: "private" } },
        { times: ["18:00"], q: {}, over: { scheduleKind: "prn", scheduleJson: "{}" } },
      ]);
      const other = await setup();
      const s = await begin(plan);
      for (const id of [other.medIds[0]!, medIds[2]!]) expect((await fill("mom", plan, s, id)).status).toBe(404);
      expect((await fill("dad", plan, s, medIds[1]!)).status).toBe(404);
      expect((await fill("mom", plan, s, medIds[1]!)).status).toBe(200);
    });
  });

  describe("when the instructions change mid-session", () => {
    it("holds further filling until they are reviewed, and never touches what was filled", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const done = await fillOk(plan, s, medIds[0]!);
      // a pill quantity changes
      await inDb((tx) => tx.update(healthMedicationDoseQuantities).set({ quantityQuarters: 6 }).where(and(eq(healthMedicationDoseQuantities.medicationId, medIds[1]!), sql`true`)));
      const read = (await getSession("mom", plan, s.id)).json.session;
      expect(read.reviewRequired).toBe(true);
      expect(read.changes.medications).toEqual([
        { medicationId: medIds[1], kinds: ["quantity"], added: 0, removed: 0, quantityChanged: 31, compartmentChanged: 0, dates: expect.any(Array) },
      ]);
      expect(med(read, medIds[0]!)).toMatchObject({ status: "filled", filledDays: 31 });
      const blocked = await fill("mom", plan, done.session, medIds[1]!);
      expect(blocked.status).toBe(409);
      expect(blocked.json.error).toBe("review_required");
      expect(blocked.json.session.changes.changed).toBe(true);
      expect(await fillRows(s.id)).toHaveLength(1);

      const reviewed = await act("mom", plan, read, "review");
      expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
      expect(reviewed.json.session).toMatchObject({ reviewRequired: false, changes: null, version: read.version + 1 });
      expect(reviewed.json.changes.medications[0]).toMatchObject({ medicationId: medIds[1], kinds: ["quantity"] });
      expect(med(reviewed.json.session, medIds[1]!).totalPills).toBe(31 * 1.5);
      expect(med(reviewed.json.session, medIds[0]!)).toMatchObject({ status: "filled" });
      expect((await fill("mom", plan, reviewed.json.session, medIds[1]!)).status).toBe(200);
    });

    it("tells apart a changed schedule, quantity and compartment", async () => {
      const { plan, medIds, compartments } = await setup([
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: ["12:00"], q: { "12:00": 4 } },
        { times: ["18:00"], q: { "18:00": 4 } },
      ]);
      const s = await begin(plan);
      await inDb((tx) => tx.update(healthMedicationDoseQuantities).set({ quantityQuarters: 8 }).where(eq(healthMedicationDoseQuantities.medicationId, medIds[0]!)));
      await inDb((tx) => tx.update(healthMedications).set({ scheduleJson: JSON.stringify({ times: ["08:00"], daysOfWeek: [1, 3, 5] }) }).where(eq(healthMedications.id, medIds[1]!)));
      const moved = await call("mom", "PATCH", `/${plan.id}`, { version: plan.version, timeMap: { "08:00": compartments[0]!.id, "12:00": compartments[1]!.id, "18:00": compartments[3]!.id } });
      expect(moved.status).toBe(200);
      const read = (await getSession("mom", plan, s.id)).json.session;
      const kinds = Object.fromEntries(read.changes.medications.map((m: Json) => [m.medicationId, m.kinds]));
      expect(kinds[medIds[0]!]).toEqual(["quantity"]);
      expect(kinds[medIds[1]!]).toEqual(["schedule"]);
      expect(kinds[medIds[2]!]).toEqual(["compartment"]);
    });

    it("asks for a review when a compartment is renamed, and says which, since the name is part of the instructions", async () => {
      const { plan, compartments } = await setup();
      const s = await begin(plan);
      const renamed = await call("mom", "PATCH", `/${plan.id}`, { version: plan.version, compartments: compartments.map((c, i) => ({ id: c.id, name: i === 0 ? "Breakfast" : c.name })) });
      expect(renamed.status).toBe(200);
      const read = (await getSession("mom", plan, s.id)).json.session;
      expect(read.reviewRequired).toBe(true);
      expect(read.changes).toEqual({ changed: true, medications: [], compartments: [{ id: compartments[0]!.id, from: "Morning", to: "Breakfast" }] });
      const reviewed = await act("mom", plan, read, "review");
      expect(reviewed.json.session.compartments[0].name).toBe("Breakfast");
      expect(reviewed.json.session.reviewRequired).toBe(false);
    });

    it("does not stop for a change that has nothing to do with the instructions", async () => {
      const { plan } = await setup();
      const s = await begin(plan);
      const edited = await call("mom", "PATCH", `/${plan.id}`, { version: plan.version, reminderTime: "07:15", caregiverMemberIds: [people.writer!.memberId] });
      expect(edited.status).toBe(200);
      const read = (await getSession("mom", plan, s.id)).json.session;
      expect(read.reviewRequired).toBe(false);
      expect(read.changes).toBeNull();
    });

    it("does not stay in the way once the session is over", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const done = await fillOk(plan, s, medIds[0]!);
      await inDb((tx) => tx.update(healthMedicationDoseQuantities).set({ quantityQuarters: 6 }).where(eq(healthMedicationDoseQuantities.medicationId, medIds[1]!)));
      const finished = await act("mom", plan, (await getSession("mom", plan, s.id)).json.session, "finish");
      expect(finished.status, JSON.stringify(finished.json)).toBe(200);
      expect(finished.json.session).toMatchObject({ status: "finished", reviewRequired: false });
      void done;
    });

    it("will not accept instructions that are now incomplete", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      await inDb((tx) => tx.delete(healthMedicationDoseQuantities).where(eq(healthMedicationDoseQuantities.medicationId, medIds[1]!)));
      const read = (await getSession("mom", plan, s.id)).json.session;
      expect(read.reviewRequired).toBe(true);
      const res = await act("mom", plan, read, "review");
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("setup_incomplete");
    });

    it("shows a change to a medication the viewer cannot see to nobody who cannot see it", async () => {
      const { plan, medIds } = await setup([
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: ["12:00"], q: { "12:00": 4 }, over: { visibility: "private" } },
      ]);
      const s = await begin(plan);
      await inDb((tx) => tx.update(healthMedicationDoseQuantities).set({ quantityQuarters: 8 }).where(eq(healthMedicationDoseQuantities.medicationId, medIds[1]!)));
      const asMom = (await getSession("mom", plan, s.id)).json.session;
      expect(asMom.changes.medications.map((m: Json) => m.medicationId)).toEqual([medIds[1]]);
      const asAdmin = (await getSession("dad", plan, s.id)).json.session;
      expect(asAdmin.reviewRequired).toBe(true);
      expect(asAdmin.changes.medications).toEqual([]);
      expect(JSON.stringify(asAdmin)).not.toContain(medIds[1]!);
    });

    it("needs the version for a review, and a repeat of one is just a new version", async () => {
      const { plan } = await setup();
      const s = await begin(plan);
      const stale = await call("mom", "POST", `/${plan.id}/sessions/${s.id}/review`, { version: 9 });
      expect(stale.status).toBe(409);
      expect((await call("mom", "POST", `/${plan.id}/sessions/${s.id}/review`, {})).json.error).toBe("invalid_version");
    });
  });

  describe("taking a fill back", () => {
    it("clears the estimate it made when it was the first, and the medication goes back to pending", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const done = await fillOk(plan, s, medIds[0]!);
      const undone = await act("mom", plan, done.session, "fills/" + done.fill.id + "/undo");
      expect(undone.status, JSON.stringify(undone.json)).toBe(200);
      expect(undone.json.supplyRestored).toBe(true);
      expect(med(undone.json.session, medIds[0]!)).toMatchObject({ status: "pending", filledDays: 0, lastFill: null });
      expect(undone.json.session.fills[0].undoneAt).toEqual(expect.any(String));
      expect(await supplyRow(medIds[0]!)).toMatchObject({ runsOutOn: null, estimatedOn: null, outsideDays: null, organizerDaysCounted: null });
      expect((await fillRows(s.id))[0]!.undoneAt).not.toBeNull();
    });

    it("puts the previous estimate back as a new revision when there was one", async () => {
      const { plan, medIds } = await setup();
      await inDb(async (tx) => {
        await tx.insert(healthMedicationSupply).values({ medicationId: medIds[0]!, runsOutOn: plus(12), estimatedOn: plus(-3), outsideDays: 15, organizerDaysCounted: 0, revision: 1 });
        await tx.insert(healthMedicationSupplyRevisions).values({ medicationId: medIds[0]!, revision: 1, source: "manual", runsOutOn: plus(12), estimatedOn: plus(-3), outsideDays: 15, organizerDaysCounted: 0 });
      });
      const s = await begin(plan);
      const done = await fillOk(plan, s, medIds[0]!);
      expect(done.supply.revision).toBe(2);
      const undone = await act("mom", plan, done.session, `fills/${done.fill.id}/undo`);
      expect(undone.json.supplyRestored).toBe(true);
      expect(await supplyRow(medIds[0]!)).toMatchObject({ runsOutOn: plus(12), outsideDays: 15, revision: 3 });
      const revs = await revisions(medIds[0]!);
      expect(revs.map((r) => [r.revision, r.source, r.runsOutOn])).toEqual([[1, "manual", plus(12)], [2, "fill", plus(41)], [3, "fill", plus(12)]]);
    });

    it("leaves the estimate alone when someone has changed it since", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const done = await fillOk(plan, s, medIds[0]!);
      await inDb(async (tx) => {
        await tx.update(healthMedicationSupply).set({ runsOutOn: plus(50), revision: 2 }).where(eq(healthMedicationSupply.medicationId, medIds[0]!));
        await tx.insert(healthMedicationSupplyRevisions).values({ medicationId: medIds[0]!, revision: 2, source: "manual", runsOutOn: plus(50), estimatedOn: today(), outsideDays: 19, organizerDaysCounted: 31 });
      });
      const undone = await act("mom", plan, done.session, `fills/${done.fill.id}/undo`);
      expect(undone.status).toBe(200);
      expect(undone.json.supplyRestored).toBe(false);
      expect(await supplyRow(medIds[0]!)).toMatchObject({ runsOutOn: plus(50), revision: 2 });
      expect(med(undone.json.session, medIds[0]!).status).toBe("pending");
    });

    it("only takes back a medication's latest fill, one at a time", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const first = await fillOk(plan, s, medIds[0]!, { coveredTo: plus(14), outsideDays: 0 });
      const second = await fillOk(plan, first.session, medIds[0]!, { coveredFrom: plus(15), coveredTo: plus(30), outsideDays: 0 });
      expect(med(second.session, medIds[0]!).lastFill.id).toBe(second.fill.id);
      const wrong = await act("mom", plan, second.session, `fills/${first.fill.id}/undo`);
      expect(wrong.status).toBe(409);
      expect(wrong.json.error).toBe("not_last_fill");
      const right = await act("mom", plan, second.session, `fills/${second.fill.id}/undo`);
      expect(right.status).toBe(200);
      expect(med(right.json.session, medIds[0]!)).toMatchObject({ status: "partial", filledDays: 15, lastFill: { id: first.fill.id } });
      expect(await supplyRow(medIds[0]!)).toMatchObject({ organizerDaysCounted: 15, revision: 3 });
      const next = await act("mom", plan, right.json.session, `fills/${first.fill.id}/undo`);
      expect(next.status).toBe(200);
      expect(med(next.json.session, medIds[0]!).status).toBe("pending");
    });

    it("does not let someone take back the fill of a medication they cannot see", async () => {
      const { plan, medIds } = await setup([
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: ["12:00"], q: { "12:00": 4 }, over: { visibility: "private" } },
      ]);
      const s = await begin(plan);
      const done = await fillOk(plan, s, medIds[1]!);
      const res = await act("dad", plan, done.session, `fills/${done.fill.id}/undo`);
      expect(res.status).toBe(404);
      expect(res.json.error).toBe("fill_not_found");
      expect((await fillRows(s.id))[0]!.undoneAt).toBeNull();
    });

    it("answers a repeat harmlessly, and refuses a stale version, a stranger's fill and an unknown one", async () => {
      const { plan, medIds } = await setup();
      const other = await setup();
      const s = await begin(plan);
      const done = await fillOk(plan, s, medIds[0]!);
      const stale = await call("mom", "POST", `/${plan.id}/sessions/${s.id}/fills/${done.fill.id}/undo`, { version: 1 });
      expect(stale.status).toBe(409);
      const ok = await act("mom", plan, done.session, `fills/${done.fill.id}/undo`);
      const again = await call("mom", "POST", `/${plan.id}/sessions/${s.id}/fills/${done.fill.id}/undo`, { version: 1 });
      expect(again.status).toBe(200);
      expect(again.json.unchanged).toBe(true);
      expect(ok.json.session.version).toBe(3);
      expect((await act("mom", plan, ok.json.session, `fills/${randomUUID()}/undo`)).status).toBe(404);
      expect((await act("mom", plan, ok.json.session, "fills/nope/undo")).status).toBe(404);
      const os = await begin(other.plan);
      const of = await fillOk(other.plan, os, other.medIds[0]!);
      expect((await act("mom", plan, ok.json.session, `fills/${of.fill.id}/undo`)).status).toBe(404);
    });
  });

  describe("ending a session", () => {
    it("finishes with what was filled, and creates no dose records", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const logsFor = () => inDb((tx) => tx.select().from(healthMedicationLogs).where(inArray(healthMedicationLogs.medicationId, medIds)));
      expect(await logsFor()).toHaveLength(0);
      const a = await fillOk(plan, s, medIds[0]!);
      const b = await fillOk(plan, a.session, medIds[1]!);
      const res = await act("writer", plan, b.session, "finish");
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.session).toMatchObject({ status: "finished", version: b.session.version + 1, progress: { total: 2, filled: 2 } });
      expect(res.json.session.finishedAt).toEqual(expect.any(String));
      // finishing says the organizer is filled; nothing was taken, so no dose is logged
      expect(await logsFor()).toHaveLength(0);
      expect((await call("mom", "GET", `/${plan.id}/sessions/current`)).json.session).toBeNull();
    });

    it("can finish with some medications unfinished, but not with nothing filled", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const empty = await act("mom", plan, s, "finish");
      expect(empty.status).toBe(409);
      expect(empty.json.error).toBe("nothing_filled");
      const a = await fillOk(plan, s, medIds[0]!);
      const undone = await act("mom", plan, a.session, `fills/${a.fill.id}/undo`);
      expect((await act("mom", plan, undone.json.session, "finish")).json.error).toBe("nothing_filled");
      const b = await fillOk(plan, undone.json.session, medIds[0]!);
      const done = await act("mom", plan, b.session, "finish");
      expect(done.json.session.progress).toMatchObject({ filled: 1, pending: 1 });
    });

    it("stops accepting fills once finished, and says the same again if finished twice", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const a = await fillOk(plan, s, medIds[0]!);
      const done = await act("mom", plan, a.session, "finish");
      const again = await call("mom", "POST", `/${plan.id}/sessions/${s.id}/finish`, { version: 1 });
      expect(again.status).toBe(200);
      expect(again.json.unchanged).toBe(true);
      const late = await fill("mom", plan, done.json.session, medIds[1]!);
      expect(late.status).toBe(409);
      expect(late.json.error).toBe("session_not_open");
      expect((await act("mom", plan, done.json.session, "abandon")).json.error).toBe("session_not_open");
    });

    it("abandons without losing what was filled: those pills are in the box", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      const a = await fillOk(plan, s, medIds[0]!, { coveredTo: plus(19), outsideDays: 0 });
      const res = await act("writer", plan, a.session, "abandon");
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.session).toMatchObject({ status: "abandoned" });
      expect(res.json.session.abandonedAt).toEqual(expect.any(String));
      expect(await fillRows(s.id)).toHaveLength(1);
      expect((await fillRows(s.id))[0]!.undoneAt).toBeNull();
      expect(await supplyRow(medIds[0]!)).toMatchObject({ organizerDaysCounted: 20 });
      expect((await call("mom", "GET", `/${plan.id}/sessions/defaults`)).json.coverageStart).toBe(plus(20));
      // the next session starts where it left off, and the days already filled count towards the estimate
      const next = await begin(plan);
      expect(next.coverageStart).toBe(plus(20));
      const top = await fillOk(plan, next, medIds[0]!, { coveredFrom: plus(20), coveredTo: plus(30), outsideDays: 0 });
      expect(top.supply).toMatchObject({ organizerDays: 31 });
      const again = await call("mom", "POST", `/${plan.id}/sessions/${s.id}/abandon`, { version: 1 });
      expect(again.json.unchanged).toBe(true);
      expect((await act("mom", plan, res.json.session, "finish")).json.error).toBe("session_not_open");
    });

    it("needs the version to end a session", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      await fillOk(plan, s, medIds[0]!);
      const stale = await call("mom", "POST", `/${plan.id}/sessions/${s.id}/finish`, { version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.json.error).toBe("version_conflict");
      expect((await call("mom", "POST", `/${plan.id}/sessions/${s.id}/finish`, {})).json.error).toBe("invalid_version");
      expect((await call("mom", "POST", `/${plan.id}/sessions/${s.id}/abandon`, { version: 1 })).status).toBe(409);
    });
  });

  describe("who may do what", () => {
    it("lets a reader look but not change anything", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      expect((await getSession("reader", plan, s.id)).status).toBe(200);
      expect((await call("reader", "GET", `/${plan.id}/sessions/current`)).status).toBe(200);
      expect((await call("reader", "GET", `/${plan.id}/sessions/defaults`)).status).toBe(200);
      expect((await fill("reader", plan, s, medIds[0]!)).status).toBe(403);
      expect((await start("reader", plan)).status).toBe(403);
      for (const what of ["review", "finish", "abandon", `fills/${randomUUID()}/undo`]) expect((await act("reader", plan, s, what)).status, what).toBe(403);
      expect(await fillRows(s.id)).toHaveLength(0);
    });

    it("keeps out someone with no access and another household", async () => {
      const { plan, medIds } = await setup();
      const s = await begin(plan);
      expect((await getSession("stranger", plan, s.id)).status).toBe(403);
      expect((await fill("stranger", plan, s, medIds[0]!)).status).toBe(403);
      expect((await getSession("outsider", plan, s.id)).status).toBe(404);
      expect((await fill("outsider", plan, s, medIds[0]!)).status).toBe(404);
      expect((await start("outsider", plan)).status).toBe(404);
    });

    it("stops a caregiver whose access is taken away partway through", async () => {
      const { plan, kid, medIds } = await setup();
      const s = await begin(plan);
      const a = await fill("writer", plan, s, medIds[0]!);
      expect(a.status).toBe(200);
      await inDb((tx) => tx.delete(healthMemberAcl).where(and(eq(healthMemberAcl.subjectMemberId, people[kid]!.memberId), eq(healthMemberAcl.granteeMemberId, people.writer!.memberId))));
      expect((await fill("writer", plan, a.json.session, medIds[1]!)).status).toBe(403);
      expect((await getSession("writer", plan, s.id)).status).toBe(403);
      expect((await act("writer", plan, a.json.session, "finish")).status).toBe(403);
      expect(await fillRows(s.id)).toHaveLength(1);
      expect((await fill("writer2", plan, a.json.session, medIds[1]!)).status).toBe(200);
    });

    it("does not open one plan's session through another's", async () => {
      const one = await setup();
      const two = await setup();
      const s = await begin(one.plan);
      expect((await getSession("mom", two.plan, s.id)).status).toBe(404);
      expect((await fill("mom", two.plan, s, one.medIds[0]!)).status).toBe(404);
    });

    it("is not available for an archived plan", async () => {
      const { plan } = await setup();
      await call("mom", "DELETE", `/${plan.id}`);
      expect((await start("mom", plan)).status).toBe(404);
    });
  });

  describe("the usual case: 31 days, four compartments, ten medications, one in several compartments", () => {
    it("works through the whole session", async () => {
      const specs: MedSpec[] = [
        { times: ["08:00"], q: { "08:00": 4 } },
        { times: ["08:00"], q: { "08:00": 2 } },
        { times: ["08:00", "21:00"], q: { "08:00": 4, "21:00": 4 } },
        { times: ["12:00"], q: { "12:00": 4 } },
        { times: ["12:00"], q: { "12:00": 6 } },
        { times: ["18:00"], q: { "18:00": 4 } },
        { times: ["21:00"], q: { "21:00": 1 } },
        { times: ["21:00"], q: { "21:00": 4 } },
        // one medication that goes in three compartments
        { times: ["08:00", "12:00", "21:00"], q: { "08:00": 4, "12:00": 2, "21:00": 4 } },
        { times: ["18:00", "21:00"], q: { "18:00": 4, "21:00": 8 } },
      ];
      const { plan, medIds, compartments } = await setup(specs);
      const s = await begin(plan);
      expect(s.medications).toHaveLength(10);
      expect(s.compartments).toHaveLength(4);
      const multi = med(s, medIds[8]!);
      expect(multi.byCompartment).toEqual([
        { compartmentId: compartments[0]!.id, pills: 31 },
        { compartmentId: compartments[1]!.id, pills: 15.5 },
        { compartmentId: compartments[3]!.id, pills: 31 },
      ]);
      expect(multi.totalPills).toBe(77.5);
      // in any order, saving each as it is done
      let current = s;
      const order = [...medIds].reverse();
      for (const [i, id] of order.entries()) {
        const res = await fillOk(plan, current, id, { outsideDays: i });
        current = res.session;
        expect(current.progress.filled).toBe(i + 1);
      }
      expect(current).toMatchObject({ version: 11, progress: { total: 10, filled: 10, partial: 0, pending: 0 } });
      const finished = await act("mom", plan, current, "finish");
      expect(finished.json.session.status).toBe("finished");
      for (const [i, id] of order.entries()) expect(await supplyRow(id)).toMatchObject({ runsOutOn: plus(31 + i), organizerDaysCounted: 31, outsideDays: i });
    });
  });
});
