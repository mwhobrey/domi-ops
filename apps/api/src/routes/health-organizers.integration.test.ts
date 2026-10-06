import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { todayIsoDateInTz } from "@domi-ops/calendar-sync";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthMedicationDoseQuantities,
  healthMedicationGroupMembers,
  healthMedicationGroups,
  healthMedications,
  healthMemberAcl,
  healthOrganizerCompartments,
  healthOrganizerPlanCaregivers,
  healthOrganizerPlans,
  healthOrganizerSessions,
  healthOrganizerTimeMap,
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

/**
 * WHO-424: organizer plan setup against a real Postgres as the app role. Auth is faked by a parent app
 * from the `x-as` header; the tenant middleware and everything below it are the real code. The household
 * clock is UTC. Skipped without a database.
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

maybeDescribe("organizer plans (integration)", () => {
  const marker = `who424-${Date.now()}`;
  const today = () => todayIsoDateInTz("UTC");
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
          .values({ email: `who424-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
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

  const inDb = <T>(fn: (tx: Database) => Promise<T>) => withHouseholdContext(baseDb, hhId, fn);

  /** A fresh child with a plan-less slate, so each test owns its person. */
  async function newPerson(): Promise<string> {
    const key = `kid-${randomUUID().slice(0, 6)}`;
    await withSystemContext(baseDb, async (tx) => {
      const [u] = await tx.insert(users).values({ email: `who424-${randomUUID()}@test.local`, displayName: key, emailVerified: true }).returning({ id: users.id });
      userIds.push(u.id);
      const [row] = await tx.insert(householdMembers).values({ householdId: hhId, userId: u.id, role: "child", name: key }).returning({ id: householdMembers.id });
      people[key] = { userId: u.id, memberId: row.id, householdId: hhId, role: "child" };
    });
    await inDb((tx) =>
      tx.insert(healthMemberAcl).values([
        { householdId: hhId, subjectMemberId: people[key]!.memberId, granteeMemberId: people.reader!.memberId, medicationsAccess: "read" },
        { householdId: hhId, subjectMemberId: people[key]!.memberId, granteeMemberId: people.writer!.memberId, medicationsAccess: "write" },
      ]),
    );
    return key;
  }

  async function makePlan(subject: string, over: Record<string, unknown> = {}, as = "mom"): Promise<Json> {
    const res = await call(as, "POST", "/", { memberId: people[subject]!.memberId, scheduleKind: "every_n_days", everyN: 30, ...over });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json.plan;
  }

  const patch = (as: string, plan: Json, body: Record<string, unknown>, version = plan.version) =>
    call(as, "PATCH", `/${plan.id}`, { version, ...body });

  async function makeMed(subject: string, over: Partial<typeof healthMedications.$inferInsert> = {}, createdBy = "mom"): Promise<string> {
    return inDb(async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({
          householdId: hhId,
          memberId: people[subject]!.memberId,
          name: `${marker} med ${randomUUID().slice(0, 6)}`,
          scheduleKind: "scheduled",
          scheduleJson: JSON.stringify({ times: ["08:00"] }),
          visibility: "household",
          createdByUserId: people[createdBy]!.userId,
          ...over,
        })
        .returning({ id: healthMedications.id });
      return m.id;
    });
  }

  const quantity = (medicationId: string, time: string, quarters = 4) =>
    inDb((tx) => tx.insert(healthMedicationDoseQuantities).values({ medicationId, doseTime: time, quantityQuarters: quarters }));

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    hhId = await seedHousehold(`${marker}-home`, [
      { key: "mom", role: "owner" },
      // An admin may configure anyone's plan but does not automatically see their private records.
      { key: "dad", role: "admin" },
      { key: "reader", role: "member" },
      { key: "writer", role: "member" },
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
        who
          ? { userId: who.userId, householdId: who.householdId, memberId: who.memberId, email: null, username: null, name: null, role: who.role }
          : null,
      );
      return next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.route("/", healthOrganizerRoutes(scoped, env));
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("creating a plan", () => {
    it("starts with four named compartments, today as the anchor, 31 days and a 9 o'clock reminder", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      expect(plan).toMatchObject({
        memberId: people[kid]!.memberId,
        scheduleKind: "every_n_days",
        everyN: 30,
        monthlyDay: null,
        anchorDate: today(),
        fillLengthDays: 31,
        reminderTime: "09:00",
        version: 1,
        archivedAt: null,
        canEdit: true,
        timeMap: {},
      });
      expect(plan.compartments.map((c: Json) => [c.name, c.position])).toEqual([["Morning", 0], ["Lunch", 1], ["Supper", 2], ["Night", 3]]);
    });

    it("reminds the person configuring it by default, or the people named", async () => {
      const kid = await newPerson();
      expect((await makePlan(kid, {}, "writer")).caregiverMemberIds).toEqual([people.writer!.memberId]);
      const kid2 = await newPerson();
      const named = await makePlan(kid2, { caregiverMemberIds: [people.reader!.memberId, people.mom!.memberId] });
      expect(named.caregiverMemberIds.sort()).toEqual([people.reader!.memberId, people.mom!.memberId].sort());
      const kid3 = await newPerson();
      expect((await makePlan(kid3, { caregiverMemberIds: [] })).caregiverMemberIds).toEqual([]);
    });

    it("takes the schedule, dates, length, time and compartment names it is given", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid, {
        scheduleKind: "monthly_date",
        monthlyDay: 31,
        everyN: undefined,
        anchorDate: "2026-01-31",
        fillLengthDays: 28,
        reminderTime: "07:30",
        compartments: ["AM", "PM"],
      });
      expect(plan).toMatchObject({ scheduleKind: "monthly_date", monthlyDay: 31, everyN: null, anchorDate: "2026-01-31", fillLengthDays: 28, reminderTime: "07:30" });
      expect(plan.compartments.map((c: Json) => c.name)).toEqual(["AM", "PM"]);
    });

    it("allows only one live plan per person, even when several are created at once", async () => {
      const kid = await newPerson();
      const results = await Promise.all([1, 2, 3, 4].map((i) => call(i % 2 ? "mom" : "writer", "POST", "/", { memberId: people[kid]!.memberId, scheduleKind: "every_n_days", everyN: 30 })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const refused = results.filter((r) => r.status === 409);
      expect(refused).toHaveLength(3);
      for (const r of refused) expect(r.json.error).toBe("plan_exists");
      const plans = await inDb((tx) => tx.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.memberId, people[kid]!.memberId)));
      expect(plans).toHaveLength(1);
      const compartments = await inDb((tx) => tx.select().from(healthOrganizerCompartments).where(eq(healthOrganizerCompartments.planId, plans[0]!.id)));
      expect(compartments).toHaveLength(4);
    });

    it("answers plan_exists, not an error, when another request creates the plan while this one waits", async () => {
      const kid = await newPerson();
      let inserted!: () => void;
      let release!: () => void;
      const hasInserted = new Promise<void>((r) => (inserted = r));
      const go = new Promise<void>((r) => (release = r));
      // Another request has inserted the plan but not committed yet, so this one cannot see it.
      const holder = inDb(async (tx) => {
        await tx.insert(healthOrganizerPlans).values({ householdId: hhId, memberId: people[kid]!.memberId, scheduleKind: "every_n_days", everyN: 20, anchorDate: today() });
        inserted();
        await go;
      });
      await hasInserted;
      const pending = call("mom", "POST", "/", { memberId: people[kid]!.memberId, scheduleKind: "every_n_days", everyN: 30 });
      await new Promise((r) => setTimeout(r, 400));
      release();
      await holder;
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.json).toMatchObject({ error: "plan_exists", plan: { everyN: 20 } });
      const plans = await inDb((tx) => tx.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.memberId, people[kid]!.memberId)));
      expect(plans).toHaveLength(1);
    });

    it("hands back the existing plan when one already exists", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const again = await call("mom", "POST", "/", { memberId: people[kid]!.memberId, scheduleKind: "every_n_days", everyN: 10 });
      expect(again.status).toBe(409);
      expect(again.json).toMatchObject({ error: "plan_exists", plan: { id: plan.id, everyN: 30 } });
    });

    it("refuses bad input with a code and creates nothing", async () => {
      const kid = await newPerson();
      const member = people[kid]!.memberId;
      const bad: Array<[Record<string, unknown>, number, string]> = [
        [{ scheduleKind: "weekly" }, 400, "invalid_schedule_kind"],
        [{ scheduleKind: "every_n_days" }, 400, "invalid_every_n"],
        [{ scheduleKind: "every_n_days", everyN: 366 }, 400, "invalid_every_n"],
        [{ scheduleKind: "monthly_date" }, 400, "invalid_monthly_day"],
        [{ scheduleKind: "monthly_date", monthlyDay: 32 }, 400, "invalid_monthly_day"],
        [{ scheduleKind: "every_n_days", everyN: 30, anchorDate: "2026-02-30" }, 400, "invalid_anchor_date"],
        [{ scheduleKind: "every_n_days", everyN: 30, fillLengthDays: 94 }, 400, "invalid_fill_length"],
        [{ scheduleKind: "every_n_days", everyN: 30, reminderTime: "25:00" }, 400, "invalid_reminder_time"],
        [{ scheduleKind: "every_n_days", everyN: 30, compartments: [] }, 400, "invalid_compartments"],
        [{ scheduleKind: "every_n_days", everyN: 30, compartments: ["a", "A"] }, 400, "duplicate_compartment_name"],
        [{ scheduleKind: "every_n_days", everyN: 30, compartments: Array.from({ length: 9 }, (_, i) => `c${i}`) }, 409, "too_many_compartments"],
        [{ scheduleKind: "every_n_days", everyN: 30, caregiverMemberIds: ["nope"] }, 400, "invalid_caregivers"],
        [{ scheduleKind: "every_n_days", everyN: 30, caregiverMemberIds: [randomUUID()] }, 404, "caregiver_not_found"],
        [{ scheduleKind: "every_n_days", everyN: 30, caregiverMemberIds: [people.outsider!.memberId] }, 404, "caregiver_not_found"],
        [{ scheduleKind: "every_n_days", everyN: 30, caregiverMemberIds: [people.stranger!.memberId] }, 400, "caregiver_no_access"],
      ];
      for (const [body, status, code] of bad) {
        const res = await call("mom", "POST", "/", { memberId: member, ...body });
        expect(res.status, JSON.stringify(body)).toBe(status);
        expect(res.json.error, JSON.stringify(body)).toBe(code);
      }
      expect((await call("mom", "GET", `/?memberId=${member}`)).json.plan).toBeNull();
      expect((await call("mom", "POST", "/", "nope")).status).toBe(400);
    });

    it("answers 404 for a person who is not in the household", async () => {
      const body = { scheduleKind: "every_n_days", everyN: 30 };
      expect((await call("mom", "POST", "/", { ...body, memberId: randomUUID() })).status).toBe(404);
      expect((await call("mom", "POST", "/", { ...body, memberId: people.outsider!.memberId })).status).toBe(404);
      expect((await call("mom", "POST", "/", { ...body, memberId: "nope" })).status).toBe(404);
      expect((await call("mom", "POST", "/", body)).status).toBe(404);
    });
  });

  describe("reading a plan", () => {
    it("returns null for a person with no plan, and the plan for one with", async () => {
      const kid = await newPerson();
      expect((await call("mom", "GET", `/?memberId=${people[kid]!.memberId}`)).json).toEqual({ plan: null, canEdit: true });
      const plan = await makePlan(kid);
      const res = await call("reader", "GET", `/?memberId=${people[kid]!.memberId}`);
      expect(res.status).toBe(200);
      expect(res.json.plan.id).toBe(plan.id);
      expect(res.json.canEdit).toBe(false);
      expect(res.json.plan.canEdit).toBe(false);
    });

    it("is only for people who may read the person's medications", async () => {
      const kid = await newPerson();
      await makePlan(kid);
      expect((await call("stranger", "GET", `/?memberId=${people[kid]!.memberId}`)).status).toBe(403);
      expect((await call("outsider", "GET", `/?memberId=${people[kid]!.memberId}`)).status).toBe(404);
      expect((await call("mom", "GET", "/?memberId=nope")).status).toBe(404);
      expect((await call("mom", "GET", "/")).status).toBe(404);
    });

    it("does not show an archived plan", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      await call("mom", "DELETE", `/${plan.id}`);
      expect((await call("mom", "GET", `/?memberId=${people[kid]!.memberId}`)).json.plan).toBeNull();
    });
  });

  describe("changing a plan", () => {
    it("changes the schedule, keeping the kind's own number and dropping the other's", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const a = await patch("mom", plan, { everyN: 7 });
      expect(a.json.plan).toMatchObject({ scheduleKind: "every_n_days", everyN: 7, monthlyDay: null, version: 2 });
      const b = await patch("mom", a.json.plan, { scheduleKind: "monthly_date", monthlyDay: 31 });
      expect(b.json.plan).toMatchObject({ scheduleKind: "monthly_date", monthlyDay: 31, everyN: null, version: 3 });
      expect((await patch("mom", b.json.plan, { scheduleKind: "every_n_days" })).json.error).toBe("invalid_every_n");
      const c = await patch("mom", b.json.plan, { anchorDate: "2026-02-28", fillLengthDays: 93, reminderTime: "06:15" });
      expect(c.json.plan).toMatchObject({ anchorDate: "2026-02-28", fillLengthDays: 93, reminderTime: "06:15", monthlyDay: 31 });
    });

    it("needs the version it is changing", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      expect((await call("mom", "PATCH", `/${plan.id}`, { everyN: 5 })).json.error).toBe("invalid_version");
      const stale = await patch("mom", plan, { everyN: 5 }, 9);
      expect(stale.status).toBe(409);
      expect(stale.json).toMatchObject({ error: "version_conflict", plan: { id: plan.id, version: 1, everyN: 30 } });
      expect((await patch("mom", plan, { everyN: 5 })).status).toBe(200);
      expect((await patch("mom", plan, { everyN: 6 })).status).toBe(409);
    });

    it("lets only one of several concurrent changes of the same version win", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const results = await Promise.all([patch("mom", plan, { everyN: 5 }), patch("writer", plan, { everyN: 6 }), patch("mom", plan, { fillLengthDays: 20 })]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      const [row] = await inDb((tx) => tx.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, plan.id)));
      expect(row!.version).toBe(2);
    });

    it("refuses a change whose version went stale while it waited for the row", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      let locked!: () => void;
      let release!: () => void;
      const hasLock = new Promise<void>((r) => (locked = r));
      const go = new Promise<void>((r) => (release = r));
      const holder = inDb(async (tx) => {
        await tx.execute(sql`select 1 from health_organizer_plans where id = ${plan.id} for update`);
        locked();
        await go;
        await tx.update(healthOrganizerPlans).set({ everyN: 99, version: sql`${healthOrganizerPlans.version} + 1` }).where(eq(healthOrganizerPlans.id, plan.id));
      });
      await hasLock;
      const pending = patch("mom", plan, { fillLengthDays: 20 });
      await new Promise((r) => setTimeout(r, 400));
      release();
      await holder;
      const res = await pending;
      expect(res.status).toBe(409);
      const [row] = await inDb((tx) => tx.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, plan.id)));
      expect(row).toMatchObject({ everyN: 99, fillLengthDays: 31, version: 2 });
    });

    it("refuses bad input with a code and changes nothing", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const bad: Array<[Record<string, unknown>, number, string]> = [
        [{ everyN: 0 }, 400, "invalid_every_n"],
        [{ anchorDate: "soon" }, 400, "invalid_anchor_date"],
        [{ fillLengthDays: 0 }, 400, "invalid_fill_length"],
        [{ reminderTime: "9am" }, 400, "invalid_reminder_time"],
        [{ compartments: [{ id: randomUUID(), name: "x" }] }, 400, "compartment_not_found"],
        [{ compartments: [{ name: "a" }, { name: "A" }] }, 400, "duplicate_compartment_name"],
        [{ timeMap: { "8:00": randomUUID() } }, 400, "invalid_time_map"],
        [{ timeMap: { "08:00": randomUUID() } }, 400, "compartment_not_found"],
        [{ caregiverMemberIds: [people.stranger!.memberId] }, 400, "caregiver_no_access"],
        [{ assignGroup: { groupId: randomUUID(), compartmentId: plan.compartments[0].id } }, 404, "group_not_found"],
        [{ assignGroup: "x" }, 400, "invalid_group_assignment"],
        [{ assignGroup: { groupId: randomUUID(), compartmentId: randomUUID() } }, 400, "compartment_not_found"],
      ];
      for (const [body, status, code] of bad) {
        const res = await patch("mom", plan, { everyN: 3, ...body });
        expect(res.status, JSON.stringify(body)).toBe(status);
        expect(res.json.error, JSON.stringify(body)).toBe(code);
      }
      const empty = await call("mom", "PATCH", `/${plan.id}`, { version: plan.version });
      expect(empty.status).toBe(400);
      expect(empty.json.error).toBe("nothing_to_change");
      const [row] = await inDb((tx) => tx.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, plan.id)));
      expect(row).toMatchObject({ everyN: 30, version: 1 });
    });

    it("answers 404 for an unknown, archived or other household's plan", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      expect((await patch("mom", { ...plan, id: randomUUID() }, { everyN: 3 })).status).toBe(404);
      expect((await patch("mom", { ...plan, id: "nope" }, { everyN: 3 })).status).toBe(404);
      expect((await patch("outsider", plan, { everyN: 3 })).status).toBe(404);
      await call("mom", "DELETE", `/${plan.id}`);
      expect((await patch("mom", plan, { everyN: 3 })).status).toBe(404);
    });
  });

  describe("compartments", () => {
    it("renames, reorders (a swap included), adds and removes in one request", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const [morning, lunch, supper, night] = plan.compartments;
      const res = await patch("mom", plan, {
        compartments: [{ id: night.id, name: "Bedtime" }, { id: morning.id, name: "Morning" }, { name: "Snack" }, { id: lunch.id, name: "Lunch" }],
      });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const after = res.json.plan.compartments;
      expect(after.map((c: Json) => [c.name, c.position])).toEqual([["Bedtime", 0], ["Morning", 1], ["Snack", 2], ["Lunch", 3]]);
      expect(after[0].id).toBe(night.id);
      expect(after[1].id).toBe(morning.id);
      expect(after.map((c: Json) => c.id)).not.toContain(supper.id);
      const full = await patch("mom", res.json.plan, { compartments: [...after].reverse().map((c: Json) => ({ id: c.id, name: c.name })) });
      expect(full.json.plan.compartments.map((c: Json) => c.name)).toEqual(["Lunch", "Snack", "Morning", "Bedtime"]);
    });

    it("stops at eight, and needs at least one", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const eight = await patch("mom", plan, { compartments: [...plan.compartments.map((c: Json) => ({ id: c.id, name: c.name })), ...["e", "f", "g", "h"].map((name) => ({ name }))] });
      expect(eight.status, JSON.stringify(eight.json)).toBe(200);
      expect(eight.json.plan.compartments).toHaveLength(8);
      const nine = await patch("mom", eight.json.plan, { compartments: [...eight.json.plan.compartments.map((c: Json) => ({ id: c.id, name: c.name })), { name: "i" }] });
      expect(nine.status).toBe(409);
      expect(nine.json.error).toBe("too_many_compartments");
      expect((await patch("mom", eight.json.plan, { compartments: [] })).json.error).toBe("invalid_compartments");
    });

    it("takes a removed compartment's times with it, and they show up as missing", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const med = await makeMed(kid);
      await quantity(med, "08:00");
      const mapped = await patch("mom", plan, { timeMap: { "08:00": plan.compartments[0].id } });
      expect(mapped.json.plan.setup.problems).toEqual([]);
      const removed = await patch("mom", mapped.json.plan, { compartments: plan.compartments.slice(1).map((c: Json) => ({ id: c.id, name: c.name })) });
      expect(removed.json.plan.timeMap).toEqual({});
      expect(removed.json.plan.setup.problems).toEqual([{ kind: "unmapped_time", severity: "error", time: "08:00", medicationIds: [med] }]);
    });
  });

  describe("mapping dose times to compartments", () => {
    it("replaces the whole map, and an empty map clears it", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const [morning, lunch] = plan.compartments;
      const a = await patch("mom", plan, { timeMap: { "08:00": morning.id, "12:30:00": lunch.id } });
      expect(a.json.plan.timeMap).toEqual({ "08:00": morning.id, "12:30": lunch.id });
      const b = await patch("mom", a.json.plan, { timeMap: { "21:00": lunch.id } });
      expect(b.json.plan.timeMap).toEqual({ "21:00": lunch.id });
      const c = await patch("mom", b.json.plan, { timeMap: {} });
      expect(c.json.plan.timeMap).toEqual({});
    });

    it("leaves the map alone when it is not sent", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const a = await patch("mom", plan, { timeMap: { "08:00": plan.compartments[0].id } });
      const b = await patch("mom", a.json.plan, { reminderTime: "10:00" });
      expect(b.json.plan.timeMap).toEqual({ "08:00": plan.compartments[0].id });
    });

    it("refuses a compartment of another plan", async () => {
      const kid = await newPerson();
      const other = await newPerson();
      const plan = await makePlan(kid);
      const otherPlan = await makePlan(other);
      const res = await patch("mom", plan, { timeMap: { "08:00": otherPlan.compartments[0].id } });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("compartment_not_found");
    });

    it("assigns every time of a group with one request", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const group = await inDb(async (tx) => {
        const [g] = await tx
          .insert(healthMedicationGroups)
          .values({ householdId: hhId, memberId: people[kid]!.memberId, name: "Morning", scheduleKind: "scheduled", scheduleJson: JSON.stringify({ times: ["07:30", "08:00"] }), visibility: "household" })
          .returning({ id: healthMedicationGroups.id });
        return g.id;
      });
      const [morning, , supper] = plan.compartments;
      const first = await patch("mom", plan, { timeMap: { "08:00": supper.id, "18:00": supper.id }, assignGroup: { groupId: group, compartmentId: morning.id } });
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      expect(first.json.plan.timeMap).toEqual({ "07:30": morning.id, "08:00": morning.id, "18:00": supper.id });
      const second = await patch("mom", first.json.plan, { assignGroup: { groupId: group, compartmentId: supper.id } });
      expect(second.json.plan.timeMap).toEqual({ "07:30": supper.id, "08:00": supper.id, "18:00": supper.id });
    });

    it("refuses a group that is another person's, hidden, or has no fixed times", async () => {
      const kid = await newPerson();
      const other = await newPerson();
      const plan = await makePlan(kid);
      const mk = (memberKey: string, over: Partial<typeof healthMedicationGroups.$inferInsert>) =>
        inDb(async (tx) => {
          const [g] = await tx
            .insert(healthMedicationGroups)
            .values({ householdId: hhId, memberId: people[memberKey]!.memberId, name: "g", scheduleKind: "scheduled", scheduleJson: JSON.stringify({ times: ["08:00"] }), visibility: "household", createdByUserId: people.mom!.userId, ...over })
            .returning({ id: healthMedicationGroups.id });
          return g.id;
        });
      const foreign = await mk(other, {});
      const hidden = await mk(kid, { visibility: "private" });
      const interval = await mk(kid, { scheduleKind: "interval", scheduleJson: JSON.stringify({ everyMinutes: 240 }) });
      const target = plan.compartments[0].id;
      expect((await patch("mom", plan, { assignGroup: { groupId: foreign, compartmentId: target } })).json.error).toBe("group_not_found");
      expect((await patch("dad", plan, { assignGroup: { groupId: hidden, compartmentId: target } })).json.error).toBe("group_not_found");
      // someone with access to the person (a grant) sees their private groups, as with their medications
      expect((await patch("writer", plan, { assignGroup: { groupId: hidden, compartmentId: target } })).status).toBe(200);
      expect((await patch("mom", plan, { assignGroup: { groupId: interval, compartmentId: target } })).json.error).toBe("invalid_group_assignment");
    });
  });

  describe("what is missing before filling works", () => {
    it("lists unmapped times, missing quantities and what is not guided", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const twice = await makeMed(kid, { scheduleJson: JSON.stringify({ times: ["08:00", "21:00"] }) });
      await quantity(twice, "08:00");
      const prn = await makeMed(kid, { scheduleKind: "prn", scheduleJson: "{}" });
      const paused = await makeMed(kid, { enabled: false });
      // a time with no compartment comes first: the missing quantity there is not reported until it has one
      const mapped = await patch("mom", plan, { timeMap: { "08:00": plan.compartments[0].id } });
      const setup = mapped.json.plan.setup;
      expect(setup.doseTimes).toEqual(["08:00", "21:00"]);
      expect(setup.ready).toBe(false);
      expect(setup.problems).toEqual([{ kind: "unmapped_time", severity: "error", time: "21:00", medicationIds: [twice] }]);
      expect(setup.notGuided).toEqual(expect.arrayContaining([{ medicationId: prn, reason: "as_needed" }, { medicationId: paused, reason: "paused" }]));
      const both = await patch("mom", mapped.json.plan, { timeMap: { "08:00": plan.compartments[0].id, "21:00": plan.compartments[3].id } });
      expect(both.json.plan.setup.problems).toEqual([{ kind: "missing_quantity", severity: "error", medicationId: twice, time: "21:00" }]);
      expect(both.json.plan.setup.ready).toBe(false);
    });

    it("is ready once every time has a compartment and a quantity", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const med = await makeMed(kid, { scheduleJson: JSON.stringify({ times: ["08:00", "21:00"] }) });
      await quantity(med, "08:00");
      await quantity(med, "21:00", 2);
      const [morning, , , night] = plan.compartments;
      const res = await patch("mom", plan, { timeMap: { "08:00": morning.id, "21:00": night.id } });
      expect(res.json.plan.setup).toMatchObject({ ready: true, problems: [], doseTimes: ["08:00", "21:00"] });
    });

    it("is not ready when there is nothing to fill", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      expect(plan.setup).toMatchObject({ ready: false, problems: [], doseTimes: [], notGuided: [] });
    });

    it("leaves out medications the viewer cannot see", async () => {
      const kid = await newPerson();
      await makePlan(kid);
      const hidden = await makeMed(kid, { visibility: "private", scheduleJson: JSON.stringify({ times: ["13:00"] }) }, "mom");
      const seenByMom = await call("mom", "GET", `/?memberId=${people[kid]!.memberId}`);
      expect(seenByMom.json.plan.setup.doseTimes).toEqual(["13:00"]);
      expect(seenByMom.json.plan.setup.problems.map((p: Json) => p.medicationIds ?? p.medicationId).flat()).toContain(hidden);
      // someone with a grant on the person sees their private medications too
      const seenByWriter = await call("writer", "GET", `/?memberId=${people[kid]!.memberId}`);
      expect(seenByWriter.json.plan.setup.doseTimes).toEqual(["13:00"]);
      // an admin can configure the plan but does not see the private medication, or learn its time
      const seenByAdmin = await call("dad", "GET", `/?memberId=${people[kid]!.memberId}`);
      expect(seenByAdmin.json.canEdit).toBe(true);
      expect(seenByAdmin.json.plan.setup.doseTimes).toEqual([]);
      expect(seenByAdmin.json.plan.setup.problems).toEqual([]);
      expect(JSON.stringify(seenByAdmin.json)).not.toContain(hidden);
    });
  });

  describe("groups the viewer cannot see", () => {
    it("do not change what the viewer is told about the setup", async () => {
      const kid = await newPerson();
      await makePlan(kid);
      const med = await makeMed(kid);
      const group = (name: string, visibility: "household" | "private") =>
        inDb(async (tx) => {
          const [g] = await tx
            .insert(healthMedicationGroups)
            .values({
              householdId: hhId,
              memberId: people[kid]!.memberId,
              name,
              scheduleKind: "scheduled",
              scheduleJson: JSON.stringify({ times: ["08:00"] }),
              visibility,
              createdByUserId: people.mom!.userId,
            })
            .returning({ id: healthMedicationGroups.id });
          await tx.insert(healthMedicationGroupMembers).values({ groupId: g.id, medicationId: med });
          return g.id;
        });
      await group("Visible", "household");
      await group("Secret", "private");
      const warnings = (json: Json) => json.plan.setup.problems.filter((p: Json) => p.kind === "double_claim");
      const mine = await call("mom", "GET", `/?memberId=${people[kid]!.memberId}`);
      expect(warnings(mine.json)).toEqual([{ kind: "double_claim", severity: "warning", medicationId: med, time: "08:00" }]);
      // An admin can configure the plan but does not see the private group, so the clash it causes is not theirs to learn.
      const admin = await call("dad", "GET", `/?memberId=${people[kid]!.memberId}`);
      expect(admin.json.canEdit).toBe(true);
      expect(warnings(admin.json)).toEqual([]);
    });
  });

  describe("who is reminded", () => {
    it("replaces the list, and each person must be in the household with at least read access", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const a = await patch("mom", plan, { caregiverMemberIds: [people.reader!.memberId, people.writer!.memberId] });
      expect(a.json.plan.caregiverMemberIds.sort()).toEqual([people.reader!.memberId, people.writer!.memberId].sort());
      const b = await patch("mom", a.json.plan, { caregiverMemberIds: [] });
      expect(b.json.plan.caregiverMemberIds).toEqual([]);
      const c = await patch("mom", b.json.plan, { caregiverMemberIds: [people.stranger!.memberId] });
      expect(c.status).toBe(400);
      expect(c.json.error).toBe("caregiver_no_access");
      const d = await patch("mom", b.json.plan, { caregiverMemberIds: [people.outsider!.memberId] });
      expect(d.status).toBe(404);
      const rows = await inDb((tx) => tx.select().from(healthOrganizerPlanCaregivers).where(eq(healthOrganizerPlanCaregivers.planId, plan.id)));
      expect(rows).toHaveLength(0);
    });
  });

  describe("who may change it", () => {
    it("lets a writer configure, and refuses a reader, a stranger and another household", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid, {}, "writer");
      expect((await patch("writer", plan, { everyN: 14 })).status).toBe(200);
      const v = (await call("mom", "GET", `/?memberId=${people[kid]!.memberId}`)).json.plan;
      expect((await patch("reader", v, { everyN: 15 })).status).toBe(403);
      expect((await patch("stranger", v, { everyN: 15 })).status).toBe(403);
      expect((await call("reader", "DELETE", `/${v.id}`)).status).toBe(403);
      expect((await call("outsider", "DELETE", `/${v.id}`)).status).toBe(404);
      const kid2 = await newPerson();
      expect((await call("reader", "POST", "/", { memberId: people[kid2]!.memberId, scheduleKind: "every_n_days", everyN: 5 })).status).toBe(403);
      expect((await call("stranger", "POST", "/", { memberId: people[kid2]!.memberId, scheduleKind: "every_n_days", everyN: 5 })).status).toBe(403);
      expect((await call("mom", "GET", `/?memberId=${people[kid2]!.memberId}`)).json.plan).toBeNull();
    });

    it("stops a writer whose access was revoked", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      await inDb((tx) => tx.delete(healthMemberAcl).where(and(eq(healthMemberAcl.subjectMemberId, people[kid]!.memberId), eq(healthMemberAcl.granteeMemberId, people.writer!.memberId))));
      expect((await patch("writer", plan, { everyN: 3 })).status).toBe(403);
      expect((await call("writer", "GET", `/?memberId=${people[kid]!.memberId}`)).status).toBe(403);
    });

    it("lets the person configure their own plan", async () => {
      const kid = await newPerson();
      const res = await call(kid, "POST", "/", { memberId: people[kid]!.memberId, scheduleKind: "every_n_days", everyN: 7 });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      expect(res.json.plan.caregiverMemberIds).toEqual([people[kid]!.memberId]);
    });
  });

  describe("archiving", () => {
    it("archives, keeps the rows, and allows a new plan afterwards", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      expect((await call("mom", "DELETE", `/${plan.id}`)).json).toEqual({ archived: true });
      expect((await call("mom", "DELETE", `/${plan.id}`)).json).toEqual({ archived: true });
      const [row] = await inDb((tx) => tx.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, plan.id)));
      expect(row!.archivedAt).not.toBeNull();
      const compartments = await inDb((tx) => tx.select().from(healthOrganizerCompartments).where(eq(healthOrganizerCompartments.planId, plan.id)).orderBy(asc(healthOrganizerCompartments.position)));
      expect(compartments).toHaveLength(4);
      const fresh = await makePlan(kid, { everyN: 10 });
      expect(fresh.id).not.toBe(plan.id);
      expect(fresh.everyN).toBe(10);
    });

    it("is refused while a filling session is open", async () => {
      const kid = await newPerson();
      const plan = await makePlan(kid);
      const session = await inDb(async (tx) => {
        const [s] = await tx
          .insert(healthOrganizerSessions)
          .values({ planId: plan.id, coverageStart: today(), fillLengthDays: 31, snapshotJson: "{}", snapshotHash: "h" })
          .returning({ id: healthOrganizerSessions.id });
        return s.id;
      });
      const res = await call("mom", "DELETE", `/${plan.id}`);
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("open_session");
      await inDb((tx) => tx.update(healthOrganizerSessions).set({ status: "abandoned", abandonedAt: new Date() }).where(eq(healthOrganizerSessions.id, session)));
      expect((await call("mom", "DELETE", `/${plan.id}`)).status).toBe(200);
    });

    it("answers 404 for an unknown plan", async () => {
      expect((await call("mom", "DELETE", `/${randomUUID()}`)).status).toBe(404);
      expect((await call("mom", "DELETE", "/nope")).status).toBe(404);
    });
  });

  describe("month-end schedules", () => {
    it("keeps a monthly date of 29, 30 or 31 as given, to be read as the month's last day when it is shorter", async () => {
      for (const day of [29, 30, 31]) {
        const kid = await newPerson();
        const plan = await makePlan(kid, { scheduleKind: "monthly_date", monthlyDay: day, everyN: undefined, anchorDate: "2026-02-28" });
        expect(plan).toMatchObject({ scheduleKind: "monthly_date", monthlyDay: day, anchorDate: "2026-02-28" });
      }
    });
  });

  describe("the database holds the same line", () => {
    it("keeps time-map rows within their own plan's compartments", async () => {
      const kid = await newPerson();
      const other = await newPerson();
      const plan = await makePlan(kid);
      const otherPlan = await makePlan(other);
      await expect(
        inDb((tx) => tx.insert(healthOrganizerTimeMap).values({ planId: plan.id, doseTime: "08:00", compartmentId: otherPlan.compartments[0].id })),
      ).rejects.toThrow();
    });
  });
});
