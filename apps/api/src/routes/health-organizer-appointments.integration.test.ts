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
  healthMedications,
  healthMemberAcl,
  healthOrganizerOccurrenceEvents,
  healthOrganizerOccurrences,
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

/**
 * WHO-425: fill appointments and their outcomes against a real Postgres as the app role. Auth is faked by a
 * parent app from the `x-as` header; the tenant middleware and everything below it are the real code. The main
 * household's clock is UTC, a second household is in New York for the daylight saving checks. "Today" is the
 * real clock, so the dates below are all relative to it. Skipped without a database.
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

maybeDescribe("organizer appointments (integration)", () => {
  const marker = `who425-${Date.now()}`;
  const today = () => todayIsoDateInTz("UTC");
  const plus = (n: number) => addDaysUtc(today(), n);
  let baseDb: Database;
  let app: Hono<{ Variables: AppVariables }>;
  let hhId = "";
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const people: Record<string, Person> = {};

  async function seedHousehold(name: string, timezone: string, members: { key: string; role: Role }[]): Promise<string> {
    return withSystemContext(baseDb, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name, timezone, modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdIds.push(hh.id);
      for (const m of members) {
        const [u] = await tx
          .insert(users)
          .values({ email: `who425-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
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

  async function newPerson(): Promise<string> {
    const key = `kid-${randomUUID().slice(0, 6)}`;
    await withSystemContext(baseDb, async (tx) => {
      const [u] = await tx.insert(users).values({ email: `who425-${randomUUID()}@test.local`, displayName: key, emailVerified: true }).returning({ id: users.id });
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

  /** A plan that fills every 30 days, starting 60 days ago: appointments at -60, -30, 0, +30, ... */
  async function newPlan(over: Record<string, unknown> = {}): Promise<{ kid: string; plan: Json }> {
    const kid = await newPerson();
    const res = await call("mom", "POST", "/", { memberId: people[kid]!.memberId, scheduleKind: "every_n_days", everyN: 30, anchorDate: plus(-60), ...over });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return { kid, plan: res.json.plan };
  }

  const list = (as: string, plan: Json, query = "") => call(as, "GET", `/${plan.id}/appointments${query}`);
  const one = (as: string, plan: Json, date: string) => call(as, "GET", `/${plan.id}/appointments/${date}`);
  const put = (as: string, plan: Json, date: string, body: Record<string, unknown>) => call(as, "PUT", `/${plan.id}/appointments/${date}`, { version: 0, ...body });
  const resolve = (as: string, plan: Json, date: string) => call(as, "POST", `/${plan.id}/appointments/${date}/resolve`, {});
  const rows = (plan: Json) =>
    inDb((tx) => tx.select().from(healthOrganizerOccurrences).where(eq(healthOrganizerOccurrences.planId, plan.id)).orderBy(asc(healthOrganizerOccurrences.occurrenceDate)));
  const events = async (plan: Json, date: string) => {
    const [row] = (await rows(plan)).filter((r) => r.occurrenceDate === date);
    if (!row) return [];
    return inDb((tx) => tx.select().from(healthOrganizerOccurrenceEvents).where(eq(healthOrganizerOccurrenceEvents.occurrenceId, row.id)).orderBy(asc(healthOrganizerOccurrenceEvents.createdAt)));
  };

  async function session(plan: Json, over: Partial<typeof healthOrganizerSessions.$inferInsert>) {
    return inDb(async (tx) => {
      const [s] = await tx
        .insert(healthOrganizerSessions)
        .values({ planId: plan.id, coverageStart: today(), fillLengthDays: 31, snapshotJson: "{}", snapshotHash: "h", ...over })
        .returning({ id: healthOrganizerSessions.id });
      return s.id;
    });
  }
  const finishedAt = (date: string, hour = 10) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);

  async function makeMed(kid: string, over: Partial<typeof healthMedications.$inferInsert> = {}, createdBy = "mom"): Promise<string> {
    return inDb(async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({
          householdId: hhId,
          memberId: people[kid]!.memberId,
          name: `${marker} ${randomUUID().slice(0, 6)}`,
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

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    hhId = await seedHousehold(`${marker}-home`, "UTC", [
      { key: "mom", role: "owner" },
      { key: "dad", role: "admin" },
      { key: "reader", role: "member" },
      { key: "writer", role: "member" },
      { key: "stranger", role: "member" },
    ]);
    await seedHousehold(`${marker}-other`, "UTC", [{ key: "outsider", role: "owner" }]);
    await seedHousehold(`${marker}-ny`, "America/New_York", [{ key: "nymom", role: "owner" }]);

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
    app.route("/", healthOrganizerAppointmentRoutes(scoped, env));
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("the list", () => {
    it("puts appointments on the schedule's days, past ones overdue, today's today, later ones upcoming", async () => {
      const { plan } = await newPlan();
      const res = await list("mom", plan, `?from=${plus(-60)}&to=${plus(60)}`);
      expect(res.status).toBe(200);
      expect(res.json.today).toBe(today());
      expect(res.json.canEdit).toBe(true);
      expect(res.json.appointments.map((a: Json) => [a.date, a.status])).toEqual([
        [plus(-60), "overdue"],
        [plus(-30), "overdue"],
        [plus(0), "today"],
        [plus(30), "upcoming"],
        [plus(60), "upcoming"],
      ]);
      expect(res.json.appointments[0]).toMatchObject({ nominalDate: plus(-60), outcome: "pending", version: 0, needsResolution: true, resolvedAt: null, doneBy: null, note: null });
    });

    it("by default shows the last five weeks and what is ahead", async () => {
      const { plan } = await newPlan();
      const res = await list("mom", plan);
      const dates = res.json.appointments.map((a: Json) => a.date);
      expect(dates[0]).toBe(plus(-30));
      expect(dates).toContain(plus(0));
      expect(dates).not.toContain(plus(-60));
      expect(dates[dates.length - 1]).toBe(plus(360));
      expect(dates.filter((d: string) => d > today())).toHaveLength(12);
    });

    it("stops at twelve appointments ahead however far it is asked to look", async () => {
      const { plan } = await newPlan();
      const res = await list("mom", plan, `?from=${plus(1)}&to=${plus(400)}`);
      expect(res.json.appointments).toHaveLength(12);
      expect(res.json.appointments[11].date).toBe(plus(360));
    });

    it("gives each appointment its whole local day as the window", async () => {
      const { plan } = await newPlan();
      const [a] = (await list("mom", plan, `?from=${plus(30)}&to=${plus(30)}`)).json.appointments;
      expect(a.windowStart).toBe(`${plus(30)}T00:00:00.000Z`);
      expect(a.windowEnd).toBe(`${plus(31)}T00:00:00.000Z`);
    });

    it("never lists a day before the plan's anchor", async () => {
      const { plan } = await newPlan();
      const res = await list("mom", plan, `?from=${plus(-200)}&to=${plus(-61)}`);
      expect(res.json.appointments).toEqual([]);
    });

    it("lands monthly dates on the last day of a short month, leap years included", async () => {
      const { plan } = await newPlan({ scheduleKind: "monthly_date", monthlyDay: 31, everyN: undefined, anchorDate: "2027-12-31" });
      const res = await list("mom", plan, "?from=2027-12-01&to=2028-05-31");
      expect(res.json.appointments.map((a: Json) => a.date)).toEqual(["2027-12-31", "2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30", "2028-05-31"]);
    });

    it("refuses a range that is backwards, too long or not dates", async () => {
      const { plan } = await newPlan();
      for (const q of [`?from=${plus(10)}&to=${plus(1)}`, `?from=${plus(-300)}&to=${plus(200)}`, "?from=soon", "?to=2026-02-30"]) {
        const res = await list("mom", plan, q);
        expect(res.status, q).toBe(400);
        expect(res.json.error, q).toBe("invalid_range");
      }
    });
  });

  describe("counting as done by default", () => {
    it("is done at the end of its day when a session was finished that day or the next", async () => {
      const { plan } = await newPlan();
      await session(plan, { status: "finished", finishedAt: finishedAt(plus(-30)) });
      const statuses = async () => Object.fromEntries((await list("mom", plan, `?from=${plus(-60)}&to=${plus(0)}`)).json.appointments.map((a: Json) => [a.date, [a.status, a.doneBy]]));
      expect(await statuses()).toMatchObject({ [plus(-30)]: ["done", "session"], [plus(-60)]: ["overdue", null] });
      // the day after counts too
      await session(plan, { status: "finished", finishedAt: finishedAt(plus(-59)) });
      expect((await statuses())[plus(-60)]).toEqual(["done", "session"]);
    });

    it("is not done by a session finished two days after, an open one or an abandoned one", async () => {
      const { plan } = await newPlan();
      await session(plan, { status: "finished", finishedAt: finishedAt(plus(-58)) });
      await session(plan, { status: "abandoned", abandonedAt: finishedAt(plus(-30)) });
      await session(plan, { status: "open" });
      const res = await list("mom", plan, `?from=${plus(-60)}&to=${plus(-30)}`);
      expect(res.json.appointments.map((a: Json) => a.status)).toEqual(["overdue", "overdue"]);
    });

    it("is not done during its own day by a session finished that day, only once the day ends", async () => {
      const { plan } = await newPlan();
      await session(plan, { status: "finished", finishedAt: new Date() });
      const [a] = (await list("mom", plan, `?from=${plus(0)}&to=${plus(0)}`)).json.appointments;
      expect(a.status).toBe("today");
    });

    it("is not done by an open or abandoned session started from it", async () => {
      const { plan } = await newPlan();
      await put("mom", plan, plus(-30), { outcome: "pending", note: "x" });
      await put("mom", plan, plus(-60), { outcome: "pending", note: "x" });
      const byDate = Object.fromEntries((await rows(plan)).map((r) => [r.occurrenceDate, r.id]));
      await session(plan, { status: "open", occurrenceId: byDate[plus(-30)] });
      await session(plan, { status: "abandoned", abandonedAt: finishedAt(plus(-45)), occurrenceId: byDate[plus(-60)] });
      const res = await list("mom", plan, `?from=${plus(-60)}&to=${plus(-30)}`);
      expect(res.json.appointments.map((a: Json) => a.status)).toEqual(["overdue", "overdue"]);
    });

    it("is done at once when the session was started from the appointment", async () => {
      const { plan } = await newPlan();
      const first = await put("mom", plan, plus(0), { outcome: "pending", note: "starting" });
      expect(first.status).toBe(200);
      const [row] = await rows(plan);
      await session(plan, { status: "finished", finishedAt: finishedAt(plus(-20)), occurrenceId: row!.id });
      const [a] = (await list("mom", plan, `?from=${plus(0)}&to=${plus(0)}`)).json.appointments;
      expect(a).toMatchObject({ status: "done", doneBy: "session" });
    });

    it("does not override what the person said", async () => {
      const { plan } = await newPlan();
      await session(plan, { status: "finished", finishedAt: finishedAt(plus(-30)) });
      const res = await put("mom", plan, plus(-30), { outcome: "missed" });
      expect(res.json.appointment).toMatchObject({ outcome: "missed", status: "missed", doneBy: null });
    });
  });

  describe("saying what happened", () => {
    it("takes each outcome after the fact and before it", async () => {
      const { plan } = await newPlan();
      const cases: Array<[string, string, string]> = [
        [plus(-60), "done", "done"],
        [plus(-30), "skipped", "skipped"],
        [plus(0), "missed", "missed"],
        [plus(30), "skipped", "skipped"],
        [plus(60), "done", "done"],
      ];
      for (const [date, outcome, status] of cases) {
        const res = await put("mom", plan, date, { outcome });
        expect(res.status, `${date} ${outcome} ${JSON.stringify(res.json)}`).toBe(200);
        expect(res.json.appointment).toMatchObject({ nominalDate: date, outcome, status, version: 1 });
      }
      const listed = (await list("mom", plan, `?from=${plus(-60)}&to=${plus(60)}`)).json.appointments;
      expect(listed.map((a: Json) => a.status)).toEqual(["done", "skipped", "missed", "skipped", "done"]);
      expect(listed[0]).toMatchObject({ doneBy: "user", needsResolution: false });
      expect(listed[1].needsResolution).toBe(true);
    });

    it("treats a note of only spaces as no note", async () => {
      const { plan } = await newPlan();
      const res = await put("mom", plan, plus(-30), { outcome: "skipped", note: "   " });
      expect(res.json.appointment.note).toBeNull();
      expect((await rows(plan))[0]!.note).toBeNull();
    });

    it("keeps a note, and keeps it encrypted", async () => {
      const { plan } = await newPlan();
      const res = await put("mom", plan, plus(-30), { outcome: "skipped", note: "  hospital stay  " });
      expect(res.json.appointment.note).toBe("hospital stay");
      const [row] = await rows(plan);
      expect(row!.note).toMatch(/^enc:v1:/);
    });

    it("can go back to pending, which forgets the move, the note and any resolution", async () => {
      const { plan } = await newPlan();
      const moved = await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(35), note: "away" });
      const back = await call("mom", "PUT", `/${plan.id}/appointments/${plus(30)}`, { outcome: "pending", version: moved.json.appointment.version });
      expect(back.json.appointment).toMatchObject({ outcome: "pending", rescheduledTo: null, note: null, date: plus(30), status: "upcoming" });
      expect(await events(plan, plus(30))).toMatchObject([{ fromOutcome: "pending", toOutcome: "rescheduled" }, { fromOutcome: "rescheduled", toOutcome: "pending" }]);
    });

    it("refuses bad input with a code and writes nothing", async () => {
      const { plan } = await newPlan();
      const bad: Array<[Record<string, unknown>, number, string]> = [
        [{}, 400, "invalid_outcome"],
        [{ outcome: "later" }, 400, "invalid_outcome"],
        [{ outcome: "skipped", version: -1 }, 400, "invalid_version"],
        [{ outcome: "skipped", version: "0" }, 400, "invalid_version"],
        [{ outcome: "skipped", note: "x".repeat(501) }, 400, "invalid_note"],
        [{ outcome: "skipped", note: 5 }, 400, "invalid_note"],
        [{ outcome: "rescheduled" }, 400, "reschedule_needs_date"],
        [{ outcome: "rescheduled", rescheduledTo: "tomorrow" }, 400, "invalid_reschedule_date"],
        [{ outcome: "skipped", rescheduledTo: plus(5) }, 400, "reschedule_date_not_allowed"],
        [{ outcome: "rescheduled", rescheduledTo: plus(30) }, 400, "invalid_reschedule_date"],
        [{ outcome: "rescheduled", rescheduledTo: plus(30 + 367) }, 400, "invalid_reschedule_date"],
        [{ outcome: "rescheduled", rescheduledTo: plus(30 - 367) }, 400, "invalid_reschedule_date"],
      ];
      for (const [body, status, code] of bad) {
        const res = await call("mom", "PUT", `/${plan.id}/appointments/${plus(30)}`, { version: 0, ...body });
        expect(res.status, JSON.stringify(body)).toBe(status);
        expect(res.json.error, JSON.stringify(body)).toBe(code);
      }
      expect((await call("mom", "PUT", `/${plan.id}/appointments/${plus(30)}`, "nope")).status).toBe(400);
      expect(await rows(plan)).toHaveLength(0);
    });

    it("only knows days the schedule puts an appointment on", async () => {
      const { plan } = await newPlan();
      for (const date of [plus(1), plus(-61), plus(-90), plus(391), plus(390), "2026-02-30", "soon"]) {
        const res = await put("mom", plan, date, { outcome: "skipped" });
        expect(res.status, date).toBe(404);
        expect(res.json.error, date).toBe("appointment_not_found");
      }
      expect((await one("mom", plan, plus(1))).status).toBe(404);
      expect((await resolve("mom", plan, plus(1))).status).toBe(404);
      // the twelfth ahead is the last one
      expect((await put("mom", plan, plus(360), { outcome: "skipped" })).status).toBe(200);
    });
  });

  describe("moving an appointment", () => {
    it("moves only that appointment and never the schedule", async () => {
      const { plan } = await newPlan();
      const moved = await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(35) });
      expect(moved.status, JSON.stringify(moved.json)).toBe(200);
      expect(moved.json.appointment).toMatchObject({ nominalDate: plus(30), date: plus(35), outcome: "rescheduled", rescheduledTo: plus(35), status: "upcoming", needsResolution: false });
      const listed = (await list("mom", plan, `?from=${plus(0)}&to=${plus(60)}`)).json.appointments;
      expect(listed.map((a: Json) => [a.nominalDate, a.date])).toEqual([[plus(0), plus(0)], [plus(30), plus(35)], [plus(60), plus(60)]]);
      expect((await call("mom", "GET", `/?memberId=${plan.memberId}`)).json.plan).toMatchObject({ anchorDate: plus(-60), everyN: 30, version: 1 });
    });

    it("shows the moved appointment where it landed, and not where it was", async () => {
      const { plan } = await newPlan();
      await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(45) });
      expect((await list("mom", plan, `?from=${plus(29)}&to=${plus(31)}`)).json.appointments).toEqual([]);
      const there = (await list("mom", plan, `?from=${plus(44)}&to=${plus(46)}`)).json.appointments;
      expect(there).toHaveLength(1);
      expect(there[0]).toMatchObject({ nominalDate: plus(30), date: plus(45) });
    });

    it("can move to an earlier day, even one in the past, and is judged on that day", async () => {
      const { plan } = await newPlan();
      const res = await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(-3) });
      expect(res.json.appointment).toMatchObject({ date: plus(-3), status: "overdue", needsResolution: true });
      await session(plan, { status: "finished", finishedAt: finishedAt(plus(-3)) });
      expect((await one("mom", plan, plus(30))).json.appointment.status).toBe("done");
    });

    it("will not land on another appointment's day, scheduled or moved there", async () => {
      const { plan } = await newPlan();
      const onScheduled = await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(60) });
      expect(onScheduled.status).toBe(409);
      expect(onScheduled.json.error).toBe("date_taken");
      expect((await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(35) })).status).toBe(200);
      const onMoved = await put("mom", plan, plus(60), { outcome: "rescheduled", rescheduledTo: plus(35) });
      expect(onMoved.status).toBe(409);
      expect(onMoved.json.error).toBe("date_taken");
      // a day whose appointment moved away is free again
      const free = await put("mom", plan, plus(60), { outcome: "rescheduled", rescheduledTo: plus(30) });
      expect(free.status, JSON.stringify(free.json)).toBe(200);
    });

    it("can change its note without leaving the day it was moved to", async () => {
      const { plan } = await newPlan();
      const first = await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(35) });
      const again = await call("mom", "PUT", `/${plan.id}/appointments/${plus(30)}`, {
        outcome: "rescheduled",
        rescheduledTo: plus(35),
        note: "still away",
        version: first.json.appointment.version,
      });
      expect(again.status, JSON.stringify(again.json)).toBe(200);
      expect(again.json.appointment).toMatchObject({ date: plus(35), note: "still away", version: 2 });
    });

    it("can be moved again, which replaces the first move", async () => {
      const { plan } = await newPlan();
      const first = await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(35) });
      const second = await call("mom", "PUT", `/${plan.id}/appointments/${plus(30)}`, { outcome: "rescheduled", rescheduledTo: plus(40), version: first.json.appointment.version });
      expect(second.json.appointment).toMatchObject({ date: plus(40), version: 2 });
      expect((await list("mom", plan, `?from=${plus(34)}&to=${plus(36)}`)).json.appointments).toEqual([]);
    });
  });

  describe("repeats, versions and simultaneous changes", () => {
    it("treats saying the same thing twice as one change", async () => {
      const { plan } = await newPlan();
      const first = await put("mom", plan, plus(-30), { outcome: "skipped", note: "away" });
      expect(first.json.unchanged).toBeUndefined();
      const again = await put("mom", plan, plus(-30), { outcome: "skipped", note: "away" });
      expect(again.status).toBe(200);
      expect(again.json.unchanged).toBe(true);
      expect(again.json.appointment.version).toBe(1);
      expect(await events(plan, plus(-30))).toHaveLength(1);
      // the same thing from a stale version is still harmless
      const stale = await call("mom", "PUT", `/${plan.id}/appointments/${plus(-30)}`, { outcome: "skipped", note: "away", version: 7 });
      expect(stale.json.unchanged).toBe(true);
    });

    it("recognises a repeat even when the note has stray spaces", async () => {
      const { plan } = await newPlan();
      await put("mom", plan, plus(-30), { outcome: "skipped", note: "  away  " });
      const again = await put("mom", plan, plus(-30), { outcome: "skipped", note: "  away  " });
      expect(again.json.unchanged).toBe(true);
      expect(await events(plan, plus(-30))).toHaveLength(1);
    });

    it("needs the version it is changing", async () => {
      const { plan } = await newPlan();
      const first = await put("mom", plan, plus(-30), { outcome: "skipped" });
      const stale = await call("mom", "PUT", `/${plan.id}/appointments/${plus(-30)}`, { outcome: "missed", version: 0 });
      expect(stale.status).toBe(409);
      expect(stale.json).toMatchObject({ error: "version_conflict", appointment: { outcome: "skipped", version: 1 } });
      const wrongForNew = await call("mom", "PUT", `/${plan.id}/appointments/${plus(0)}`, { outcome: "missed", version: 4 });
      expect(wrongForNew.status).toBe(409);
      const ok = await call("mom", "PUT", `/${plan.id}/appointments/${plus(-30)}`, { outcome: "missed", version: first.json.appointment.version });
      expect(ok.status).toBe(200);
      expect(ok.json.appointment.version).toBe(2);
      expect(await events(plan, plus(-30))).toMatchObject([{ fromOutcome: "pending", toOutcome: "skipped" }, { fromOutcome: "skipped", toOutcome: "missed" }]);
    });

    it("lets only one of two simultaneous first answers win", async () => {
      const { plan } = await newPlan();
      const results = await Promise.all([put("mom", plan, plus(-30), { outcome: "skipped" }), put("writer", plan, plus(-30), { outcome: "missed" })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await rows(plan)).toHaveLength(1);
      expect(await events(plan, plus(-30))).toHaveLength(1);
    });

    it("answers a conflict, not an error, when another request records the first answer while this one waits", async () => {
      const { plan } = await newPlan();
      let inserted!: () => void;
      let release!: () => void;
      const hasInserted = new Promise<void>((r) => (inserted = r));
      const go = new Promise<void>((r) => (release = r));
      // Another request has recorded an answer but not committed, so this one cannot see it yet.
      const holder = inDb(async (tx) => {
        await tx.insert(healthOrganizerOccurrences).values({ planId: plan.id, occurrenceDate: plus(-30), outcome: "done", version: 1 });
        inserted();
        await go;
      });
      await hasInserted;
      const pending = put("mom", plan, plus(-30), { outcome: "skipped" });
      await new Promise((r) => setTimeout(r, 400));
      release();
      await holder;
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.json).toMatchObject({ error: "version_conflict", appointment: { outcome: "done", version: 1 } });
    });

    it("lets only one of several simultaneous changes of the same version win", async () => {
      const { plan } = await newPlan();
      const first = await put("mom", plan, plus(-30), { outcome: "skipped" });
      const v = first.json.appointment.version;
      const send = (as: string, outcome: string) => call(as, "PUT", `/${plan.id}/appointments/${plus(-30)}`, { outcome, version: v });
      const results = await Promise.all([send("mom", "missed"), send("writer", "done"), send("mom", "pending")]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect(await events(plan, plus(-30))).toHaveLength(2);
    });

    it("refuses a change whose version went stale while it waited for the row", async () => {
      const { plan } = await newPlan();
      const first = await put("mom", plan, plus(-30), { outcome: "skipped" });
      const [row] = await rows(plan);
      let locked!: () => void;
      let release!: () => void;
      const hasLock = new Promise<void>((r) => (locked = r));
      const go = new Promise<void>((r) => (release = r));
      const holder = inDb(async (tx) => {
        await tx.execute(sql`select 1 from health_organizer_occurrences where id = ${row!.id} for update`);
        locked();
        await go;
        await tx.update(healthOrganizerOccurrences).set({ outcome: "done", version: sql`${healthOrganizerOccurrences.version} + 1` }).where(eq(healthOrganizerOccurrences.id, row!.id));
      });
      await hasLock;
      const pending = call("mom", "PUT", `/${plan.id}/appointments/${plus(-30)}`, { outcome: "missed", version: first.json.appointment.version });
      await new Promise((r) => setTimeout(r, 400));
      release();
      await holder;
      expect((await pending).status).toBe(409);
      expect((await rows(plan))[0]).toMatchObject({ outcome: "done", version: 2 });
    });
  });

  describe("history", () => {
    it("keeps every change in order, with the notes that went with them", async () => {
      const { plan } = await newPlan();
      const a = await put("mom", plan, plus(-30), { outcome: "skipped", note: "sick" });
      const b = await call("mom", "PUT", `/${plan.id}/appointments/${plus(-30)}`, { outcome: "missed", note: "still sick", version: a.json.appointment.version });
      await call("mom", "PUT", `/${plan.id}/appointments/${plus(-30)}`, { outcome: "done", version: b.json.appointment.version });
      const res = await one("mom", plan, plus(-30));
      expect(res.json.events.map((e: Json) => [e.fromOutcome, e.toOutcome, e.note])).toEqual([
        ["pending", "skipped", "sick"],
        ["skipped", "missed", "still sick"],
        ["missed", "done", null],
      ]);
      const stored = await events(plan, plus(-30));
      expect(stored[0]!.note).toMatch(/^enc:v1:/);
    });

    it("has no history for an appointment nobody has said anything about", async () => {
      const { plan } = await newPlan();
      expect((await one("mom", plan, plus(30))).json).toMatchObject({ events: [], effects: null, appointment: { version: 0, status: "upcoming" } });
    });
  });

  describe("what skipping or missing affects", () => {
    async function scenario() {
      const { kid, plan } = await newPlan();
      const holder = await session(plan, { status: "abandoned", abandonedAt: new Date() });
      const fill = (medicationId: string, from: string, to: string) =>
        inDb((tx) => tx.insert(healthOrganizerSessionFills).values({ sessionId: holder, medicationId, coveredFrom: from, coveredTo: to, idempotencyKey: randomUUID() }));
      const supply = (medicationId: string, runsOutOn: string, extra: Partial<typeof healthMedicationSupply.$inferInsert> = {}) =>
        inDb((tx) => tx.insert(healthMedicationSupply).values({ medicationId, runsOutOn, estimatedOn: plus(-20), outsideDays: 5, organizerDaysCounted: 0, revision: 1, ...extra }));

      const a = await makeMed(kid); // pills in the organizer until +9, supply out +12 (lead 7: refill by +5)
      await fill(a, plus(-20), plus(9));
      await supply(a, plus(12));
      const b = await makeMed(kid); // covered well past the next fill, plenty of supply
      await fill(b, plus(-5), plus(40));
      await supply(b, plus(50));
      const c = await makeMed(kid); // nothing in the organizer, no supply information
      const prn = await makeMed(kid, { scheduleKind: "prn", scheduleJson: "{}" });
      const paused = await makeMed(kid, { enabled: false });
      const d = await makeMed(kid); // organizer until +20, supply out +14 (refill by +7): later than a, earlier than those without a date
      await fill(d, plus(-5), plus(20));
      await supply(d, plus(14));
      const undone = await makeMed(kid); // a fill that was undone does not count
      await inDb((tx) =>
        tx.insert(healthOrganizerSessionFills).values({ sessionId: holder, medicationId: undone, coveredFrom: plus(-5), coveredTo: plus(60), idempotencyKey: randomUUID(), undoneAt: new Date() }),
      );
      return { kid, plan, a, b, c, d, prn, paused, undone };
    }

    it("lists the medications that would go without pills before the next fill, soonest refill first", async () => {
      const { plan, a, b, c, d, prn, paused, undone } = await scenario();
      const res = await put("mom", plan, plus(0), { outcome: "skipped" });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const fx = res.json.effects;
      expect(fx).toMatchObject({ nextFillDate: plus(30), coverageEndsOn: plus(9), earliestRefillDeadline: plus(5) });
      const byId = Object.fromEntries(fx.medications.map((m: Json) => [m.medicationId, m]));
      expect(Object.keys(byId).sort()).toEqual([a, c, d, undone].sort());
      expect(byId[a]).toMatchObject({ coverageEndsOn: plus(9), daysWithoutPills: 20, runsOutOn: plus(12), refillDeadline: plus(5), refillRequested: false });
      expect(byId[c]).toMatchObject({ coverageEndsOn: null, daysWithoutPills: 30, runsOutOn: null, refillDeadline: null });
      expect(byId[b]).toBeUndefined();
      expect(byId[prn]).toBeUndefined();
      expect(byId[paused]).toBeUndefined();
      expect(byId[d]).toMatchObject({ coverageEndsOn: plus(20), daysWithoutPills: 9, refillDeadline: plus(7) });
      // soonest refill first, the ones with no refill date last
      expect(fx.medications.slice(0, 2).map((m: Json) => m.medicationId)).toEqual([a, d]);
      expect(fx.actions).toEqual(["start_session", "reschedule", "resolve"]);
    });

    it("also lists one that runs out of supply before the next fill although the organizer is full", async () => {
      const { kid, plan } = await newPlan();
      const holder = await session(plan, { status: "abandoned", abandonedAt: new Date() });
      const m = await makeMed(kid);
      await inDb((tx) => tx.insert(healthOrganizerSessionFills).values({ sessionId: holder, medicationId: m, coveredFrom: plus(-5), coveredTo: plus(60), idempotencyKey: randomUUID() }));
      await inDb((tx) => tx.insert(healthMedicationSupply).values({ medicationId: m, runsOutOn: plus(20), estimatedOn: plus(-10), outsideDays: 5, organizerDaysCounted: 0, revision: 1, leadDays: 3 }));
      const fx = (await put("mom", plan, plus(0), { outcome: "missed" })).json.effects;
      expect(fx.medications).toMatchObject([{ medicationId: m, daysWithoutPills: 0, runsOutOn: plus(20), refillDeadline: plus(17) }]);
      expect(fx.earliestRefillDeadline).toBe(plus(17));
    });

    it("shows a requested refill as requested", async () => {
      const { kid, plan } = await newPlan();
      const m = await makeMed(kid);
      await inDb((tx) => tx.insert(healthMedicationSupply).values({ medicationId: m, runsOutOn: plus(10), estimatedOn: plus(-10), outsideDays: 5, organizerDaysCounted: 0, revision: 1, requestedAt: new Date() }));
      const fx = (await put("mom", plan, plus(0), { outcome: "skipped" })).json.effects;
      expect(fx.medications[0]).toMatchObject({ medicationId: m, refillRequested: true });
    });

    it("measures a moved appointment against the day it moved to", async () => {
      const { plan } = await scenario();
      const res = await put("mom", plan, plus(0), { outcome: "rescheduled", rescheduledTo: plus(5) });
      expect(res.json.effects).toMatchObject({ nextFillDate: plus(5), actions: ["start_session", "reschedule"] });
      const a = res.json.effects.medications.find((m: Json) => m.coverageEndsOn === plus(9));
      expect(a).toBeUndefined(); // pills last past the new day, so it is not at risk
    });

    it("shows effects for an overdue appointment, and none for one that is on track", async () => {
      const { plan } = await scenario();
      expect((await one("mom", plan, plus(-30))).json.effects).toMatchObject({ nextFillDate: plus(0), actions: ["start_session", "reschedule", "resolve"] });
      expect((await one("mom", plan, plus(30))).json.effects).toBeNull();
      expect((await one("mom", plan, plus(0))).json.effects).toBeNull();
    });

    it("leaves out medications the viewer cannot see", async () => {
      const { kid, plan } = await newPlan();
      const hidden = await makeMed(kid, { visibility: "private" }, "mom");
      const seenByMom = await put("mom", plan, plus(0), { outcome: "skipped" });
      expect(seenByMom.json.effects.medications.map((m: Json) => m.medicationId)).toContain(hidden);
      const seenByAdmin = await one("dad", plan, plus(0));
      expect(seenByAdmin.status).toBe(200);
      expect(JSON.stringify(seenByAdmin.json)).not.toContain(hidden);
    });
  });

  describe("dealing with it", () => {
    it("stops flagging a skipped appointment once it is resolved, and flags it again if the answer changes", async () => {
      const { plan } = await newPlan();
      const skipped = await put("mom", plan, plus(-30), { outcome: "skipped" });
      expect(skipped.json.appointment.needsResolution).toBe(true);
      const res = await resolve("mom", plan, plus(-30));
      expect(res.status).toBe(200);
      expect(res.json.appointment).toMatchObject({ needsResolution: false, version: 2 });
      expect(res.json.appointment.resolvedAt).toEqual(expect.any(String));
      const again = await resolve("writer", plan, plus(-30));
      expect(again.json.unchanged).toBe(true);
      expect(again.json.appointment.version).toBe(2);
      const changed = await call("mom", "PUT", `/${plan.id}/appointments/${plus(-30)}`, { outcome: "missed", version: 2 });
      expect(changed.json.appointment).toMatchObject({ needsResolution: true, resolvedAt: null });
    });

    it("can acknowledge an overdue appointment nobody has answered", async () => {
      const { plan } = await newPlan();
      const res = await resolve("mom", plan, plus(-60));
      expect(res.status).toBe(200);
      expect(res.json.appointment).toMatchObject({ outcome: "pending", status: "overdue", needsResolution: false, version: 1 });
      expect(await events(plan, plus(-60))).toEqual([]);
    });

    it("has nothing to resolve for one that is upcoming, done or moved", async () => {
      const { plan } = await newPlan();
      await put("mom", plan, plus(-30), { outcome: "done" });
      await put("mom", plan, plus(30), { outcome: "rescheduled", rescheduledTo: plus(35) });
      for (const date of [plus(0), plus(-30), plus(30), plus(60)]) {
        const res = await resolve("mom", plan, date);
        expect(res.status, date).toBe(409);
        expect(res.json.error, date).toBe("nothing_to_resolve");
      }
    });

    it("lists unresolved appointments as needing it", async () => {
      const { plan } = await newPlan();
      await put("mom", plan, plus(-30), { outcome: "skipped" });
      await resolve("mom", plan, plus(-60));
      const need = (await list("mom", plan, `?from=${plus(-60)}&to=${plus(0)}`)).json.appointments.filter((a: Json) => a.needsResolution);
      expect(need.map((a: Json) => a.nominalDate)).toEqual([plus(-30)]);
    });
  });

  describe("who may see and change them", () => {
    it("lets a reader look but not change, and a writer do both", async () => {
      const { plan } = await newPlan();
      const asReader = await list("reader", plan, `?from=${plus(0)}&to=${plus(30)}`);
      expect(asReader.status).toBe(200);
      expect(asReader.json.canEdit).toBe(false);
      expect((await one("reader", plan, plus(30))).status).toBe(200);
      expect((await put("reader", plan, plus(30), { outcome: "skipped" })).status).toBe(403);
      expect((await resolve("reader", plan, plus(-30))).status).toBe(403);
      expect(await rows(plan)).toHaveLength(0);
      expect((await put("writer", plan, plus(30), { outcome: "skipped" })).status).toBe(200);
    });

    it("keeps out someone with no access, another household, and a writer whose access was revoked", async () => {
      const { kid, plan } = await newPlan();
      expect((await list("stranger", plan)).status).toBe(403);
      expect((await put("stranger", plan, plus(30), { outcome: "skipped" })).status).toBe(403);
      expect((await list("outsider", plan)).status).toBe(404);
      expect((await put("outsider", plan, plus(30), { outcome: "skipped" })).status).toBe(404);
      await inDb((tx) => tx.delete(healthMemberAcl).where(and(eq(healthMemberAcl.subjectMemberId, people[kid]!.memberId), eq(healthMemberAcl.granteeMemberId, people.writer!.memberId))));
      expect((await put("writer", plan, plus(30), { outcome: "skipped" })).status).toBe(403);
      expect((await list("writer", plan)).status).toBe(403);
    });

    it("answers 404 for an unknown or archived plan", async () => {
      const { plan } = await newPlan();
      expect((await call("mom", "GET", `/${randomUUID()}/appointments`)).status).toBe(404);
      expect((await call("mom", "GET", "/nope/appointments")).status).toBe(404);
      await call("mom", "DELETE", `/${plan.id}`);
      expect((await list("mom", plan)).status).toBe(404);
      expect((await put("mom", plan, plus(30), { outcome: "skipped" })).status).toBe(404);
    });
  });

  describe("days when the clocks change", () => {
    // Every 7 days from 1 March 2026: lands on 8 March (clocks forward) and, 245 days on, on 1 November (clocks back).
    let nyPlan: Json;
    beforeAll(async () => {
      const res = await call("nymom", "POST", "/", { memberId: people.nymom!.memberId, scheduleKind: "every_n_days", everyN: 7, anchorDate: "2026-03-01" });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      nyPlan = res.json.plan;
    });

    it("gives the day the clocks go forward 23 hours, in the household's own zone", async () => {
      const spring = (await list("nymom", nyPlan, "?from=2026-03-01&to=2026-03-15")).json.appointments;
      expect(spring.map((a: Json) => a.date)).toEqual(["2026-03-01", "2026-03-08", "2026-03-15"]);
      const day = spring[1];
      expect(day.windowStart).toBe("2026-03-08T05:00:00.000Z");
      expect(day.windowEnd).toBe("2026-03-09T04:00:00.000Z");
      expect((Date.parse(day.windowEnd) - Date.parse(day.windowStart)) / 3_600_000).toBe(23);
    });

    it("gives the day the clocks go back 25 hours, and the days around it their usual 24", async () => {
      const fall = (await list("nymom", nyPlan, "?from=2026-10-25&to=2026-11-08")).json.appointments;
      expect(fall.map((a: Json) => a.date)).toEqual(["2026-10-25", "2026-11-01", "2026-11-08"]);
      const hours = (a: Json) => (Date.parse(a.windowEnd) - Date.parse(a.windowStart)) / 3_600_000;
      expect(fall.map(hours)).toEqual([24, 25, 24]);
      expect(fall[1].windowStart).toBe("2026-11-01T04:00:00.000Z");
      expect(fall[1].windowEnd).toBe("2026-11-02T05:00:00.000Z");
    });
  });
});
