import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { addDaysUtc, todayIsoDateInTz } from "@domi-ops/calendar-sync";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthMedicationDoseQuantities,
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
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
import { healthOrganizerSessionRoutes } from "./health-organizer-sessions.js";
import { healthRefillRoutes } from "./health-refills.js";
import { healthSupplyRoutes } from "./health-supply.js";
import { householdHealthRoutes } from "./household-health.js";

/**
 * Supply entered in pills, against a real Postgres as the app role: the count is turned into days by walking the schedule,
 * kept in quarters, and a fill takes what it used out of it. Auth is faked from the `x-as` header. The household clock is
 * UTC, so "today" is todayIsoDateInTz("UTC"). Skipped without a database.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = {
  MODULES_ENABLED: ["core", "health"],
  DEPLOYMENT_MODE: "single",
  AUTH_REQUIRED: true,
  ENCRYPTION_KEY: "test-health-encryption-key-32chars!!",
} as unknown as Env;

type Person = { userId: string; memberId: string; householdId: string; role: "owner" };
// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
type Json = any;
type MedSpec = { times?: string[]; q?: Record<string, number>; over?: Partial<typeof healthMedications.$inferInsert>; days?: number[] };

maybeDescribe("medication supply in pills (integration)", () => {
  const marker = `pills-${Date.now()}`;
  const today = () => todayIsoDateInTz("UTC");
  const plus = (n: number) => addDaysUtc(today(), n);
  const todayWeekday = () => new Date(`${today()}T00:00:00Z`).getUTCDay();
  let baseDb: Database;
  let app: Hono<{ Variables: AppVariables }>;
  let hhId = "";
  let mom: Person;
  const userIds: string[] = [];

  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> => {
    const res = await app.request(path, {
      method,
      headers: { "x-as": "mom", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const inDb = <T>(fn: (tx: Database) => Promise<T>) => withHouseholdContext(baseDb, hhId, fn);
  const supplyRow = async (id: string) => (await inDb((tx) => tx.select().from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, id))))[0];
  const revisions = (id: string) =>
    inDb((tx) => tx.select().from(healthMedicationSupplyRevisions).where(eq(healthMedicationSupplyRevisions.medicationId, id)).orderBy(asc(healthMedicationSupplyRevisions.revision)));

  async function newPerson(): Promise<string> {
    return withSystemContext(baseDb, async (tx) => {
      const [u] = await tx.insert(users).values({ email: `${marker}-${randomUUID()}@test.local`, displayName: "kid", emailVerified: true }).returning({ id: users.id });
      userIds.push(u.id);
      const [row] = await tx.insert(householdMembers).values({ householdId: hhId, userId: u.id, role: "child", name: "kid" }).returning({ id: householdMembers.id });
      return row.id;
    });
  }

  async function makeMed(memberId: string, spec: MedSpec = {}): Promise<string> {
    const times = spec.times ?? ["08:00"];
    const q = spec.q ?? Object.fromEntries(times.map((t) => [t, 4]));
    return inDb(async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({
          householdId: hhId,
          memberId,
          name: `${marker} ${randomUUID().slice(0, 6)}`,
          scheduleKind: "scheduled",
          scheduleJson: JSON.stringify(spec.days ? { times, daysOfWeek: spec.days } : { times }),
          visibility: "household",
          createdByUserId: mom.userId,
          ...spec.over,
        })
        .returning({ id: healthMedications.id });
      for (const [time, quarters] of Object.entries(q)) {
        await tx.insert(healthMedicationDoseQuantities).values({ medicationId: m.id, doseTime: time, quantityQuarters: quarters });
      }
      return m.id;
    });
  }

  const med = async (spec: MedSpec = {}) => makeMed(await newPerson(), spec);
  const put = (id: string, body: unknown) => call("PUT", `/medications/${id}/supply`, body);
  async function setCount(id: string, outsidePills: number) {
    const res = await put(id, { outsidePills });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.supply as Json;
  }

  /** A plan for a person with one medication, a session of `days` days from today, and that medication's id. */
  async function sessionFor(spec: MedSpec, days = 7, count?: number) {
    const memberId = await newPerson();
    const medicationId = await makeMed(memberId, spec);
    if (count !== undefined) await setCount(medicationId, count);
    const created = await call("POST", "/organizers", { memberId, scheduleKind: "every_n_days", everyN: 30, anchorDate: today() });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const compartment = created.json.plan.compartments[0].id as string;
    const timeMap = Object.fromEntries((spec.times ?? ["08:00"]).map((t) => [t, compartment]));
    const mapped = await call("PATCH", `/organizers/${created.json.plan.id}`, { version: created.json.plan.version, timeMap });
    expect(mapped.status, JSON.stringify(mapped.json)).toBe(200);
    const started = await call("POST", `/organizers/${mapped.json.plan.id}/sessions`, { fillLengthDays: days });
    expect(started.status, JSON.stringify(started.json)).toBe(201);
    return { planId: mapped.json.plan.id as string, session: started.json.session as Json, medicationId };
  }

  const fill = (ctx: { planId: string; medicationId: string }, session: Json, body: Record<string, unknown>) =>
    call("POST", `/organizers/${ctx.planId}/sessions/${session.id}/fills`, {
      medicationId: ctx.medicationId,
      coveredFrom: session.coverageStart,
      coveredTo: session.coverageEnd,
      idempotencyKey: randomUUID(),
      version: session.version,
      ...body,
    });

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    await withSystemContext(baseDb, async (tx) => {
      const [hh] = await tx.insert(households).values({ name: marker, timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) }).returning({ id: households.id });
      hhId = hh.id;
      const [u] = await tx.insert(users).values({ email: `${marker}-mom@test.local`, displayName: "mom", emailVerified: true }).returning({ id: users.id });
      userIds.push(u.id);
      const [row] = await tx.insert(householdMembers).values({ householdId: hh.id, userId: u.id, role: "owner", name: "mom" }).returning({ id: householdMembers.id });
      mom = { userId: u.id, memberId: row.id, householdId: hh.id, role: "owner" };
    });

    const scoped = createScopedDb(baseDb);
    app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("userId", mom.userId);
      c.set("auth", { userId: mom.userId, householdId: mom.householdId, memberId: mom.memberId, email: null, username: null, name: null, role: mom.role });
      return next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.route("/", householdHealthRoutes(scoped, env));
    app.route("/", healthSupplyRoutes(scoped, env));
    app.route("/", healthRefillRoutes(scoped, env));
    app.route("/organizers", healthOrganizerRoutes(scoped, env));
    app.route("/organizers", healthOrganizerSessionRoutes(scoped, env));
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      await tx.delete(households).where(eq(households.id, hhId));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("turning a count into days", () => {
    it("previews without writing, then saves the days and keeps the count in quarters", async () => {
      const id = await med();
      const preview = await put(id, { outsidePills: 30, dryRun: true });
      expect(preview.status).toBe(200);
      expect(preview.json).toMatchObject({ dryRun: true, outsideDays: 30, totalDays: 30, runsOutOn: plus(30) });
      expect(await supplyRow(id)).toBeUndefined();

      const supply = await setCount(id, 30);
      expect(supply).toMatchObject({ runsOutOn: plus(30), outsideDays: 30, outsidePills: 30 });
      expect((await supplyRow(id))?.outsideQuarters).toBe(120);
      expect((await revisions(id)).map((r) => [r.source, r.outsideDays, r.outsideQuarters])).toEqual([["manual", 30, 120]]);
    });

    it("rounds what is left over down", async () => {
      expect((await setCount(await med(), 5.5)).outsideDays).toBe(5);
    });

    it("counts every dose of the day, and half pills exactly", async () => {
      const id = await med({ times: ["08:00", "20:00"], q: { "08:00": 4, "20:00": 2 } }); // 1½ a day
      expect((await setCount(id, 4.5)).outsideDays).toBe(3);
    });

    it("walks the real week for a medication not taken every day", async () => {
      const id = await med({ days: [todayWeekday()] }); // one dose a week, due today
      expect((await setCount(id, 2)).outsideDays).toBe(14); // today, next week, and nothing for the week after
    });

    it("says the supply covers the course when the pills outlast the medication", async () => {
      const id = await med({ over: { endDate: plus(9) } });
      expect(await setCount(id, 400)).toMatchObject({ outsideDays: 10, runsOutOn: plus(10), state: "not_needed" });
    });

    it("forgets the count when the estimate is entered in days", async () => {
      const id = await med();
      const first = await setCount(id, 30);
      const res = await put(id, { outsideDays: 12, version: first.version });
      expect(res.json.supply).toMatchObject({ outsideDays: 12, outsidePills: null });
      expect((await supplyRow(id))?.outsideQuarters).toBeNull();
    });

    it("keeps the count when a resumed estimate is confirmed", async () => {
      const id = await med();
      const first = await setCount(id, 30);
      const res = await put(id, { confirm: true, version: first.version });
      expect(res.status).toBe(200);
      expect(res.json.supply.outsidePills).toBe(30);
      expect((await revisions(id)).map((r) => r.outsideQuarters)).toEqual([120, 120]);
    });

    it.each([
      ["as needed", { over: { scheduleKind: "prn" as const, scheduleJson: "{}" } }],
      ["a liquid", { over: { form: "liquid" as const } }],
      ["no quantities", { q: {} }],
      ["a time with no quantity", { times: ["08:00", "20:00"], q: { "08:00": 4 } }],
    ])("is refused for %s, which stays in days", async (_name, spec) => {
      const id = await med(spec);
      const refused = await put(id, { outsidePills: 30 });
      expect(refused.status).toBe(400);
      expect(refused.json.error).toBe("pills_need_fixed_dose");
      expect(await supplyRow(id)).toBeUndefined();
      expect((await put(id, { outsideDays: 30 })).status).toBe(200);
    });

    it.each([
      [12.3, "invalid_outside_pills"],
      [-1, "invalid_outside_pills"],
      ["30", "invalid_outside_pills"],
      [100_001, "invalid_outside_pills"],
    ])("refuses %s pills", async (outsidePills, error) => {
      const res = await put(await med(), { outsidePills });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe(error);
    });

    it("refuses days and pills together", async () => {
      const res = await put(await med(), { outsidePills: 3, outsideDays: 3 });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("days_or_pills");
    });

    it("refuses more than ten years of pills", async () => {
      const res = await put(await med(), { outsidePills: 4000 });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("supply_too_large");
    });

    it("tells the screen which medications are counted in pills", async () => {
      const memberId = await newPerson();
      const pills = await makeMed(memberId);
      const days = await makeMed(memberId, { over: { scheduleKind: "prn", scheduleJson: "{}" }, q: {} });
      const res = await call("GET", `/medications?memberId=${memberId}`);
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const byId = new Map<string, Json>(res.json.medications.map((m: Json) => [m.id, m]));
      expect(byId.get(pills)?.countsPills).toBe(true);
      expect(byId.get(days)?.countsPills).toBe(false);
    });
  });

  describe("medications not taken every day", () => {
    it("fills a weekly pill for a month and counts the pills left on its own weeks", async () => {
      const ctx = await sessionFor({ days: [todayWeekday()] }, 29, 12); // doses today and on days 7, 14, 21 and 28
      expect(ctx.session.medications[0]).toMatchObject({ countsPills: true, requiredDays: 5, totalPills: 5 });

      const suggestion = await fill(ctx, ctx.session, { dryRun: true });
      expect(suggestion.json).toEqual({ dryRun: true, pillsUsed: 5, lastCountPills: 12, suggestedOutsidePills: 7 });

      const saved = await fill(ctx, ctx.session, { outsidePills: 7 });
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      // Seven more weekly doses on days 35 to 77, so day 84 is the first with nothing to take.
      expect(saved.json.supply).toMatchObject({ organizerDays: 29, outsideDays: 55, runsOutOn: plus(84) });
      expect(saved.json.session.medications[0]).toMatchObject({ status: "filled", missing: [] });
    });

    it("rounds a part of a weekly dose down", async () => {
      const id = await med({ days: [todayWeekday()], q: { "08:00": 8 } }); // two pills a week
      expect((await setCount(id, 5)).outsideDays).toBe(14); // today and next week; one pill is not a dose
    });

    const everyDays = (days: number) => ({
      over: {
        scheduleKind: "interval" as const,
        scheduleJson: JSON.stringify({ everyMinutes: days * 1440, anchor: "first_taken", intervalFrom: "last_taken", stop: { mode: "max_doses", maxDoses: 1 } }),
      },
      q: {},
    });

    it.each([
      ["every 3 days", 3],
      ["every 7 days", 7],
      ["every 14 days", 14],
    ])("keeps an interval pill taken %s in days", async (_name, days) => {
      const memberId = await newPerson();
      const id = await makeMed(memberId, everyDays(days));

      const list = await call("GET", `/medications?memberId=${memberId}`);
      expect(list.json.medications.find((m: Json) => m.id === id).countsPills).toBe(false);

      const pills = await put(id, { outsidePills: 4 });
      expect(pills.status).toBe(400);
      expect(pills.json.error).toBe("pills_need_fixed_dose");

      const entered = await put(id, { outsideDays: days * 4 });
      expect(entered.status, JSON.stringify(entered.json)).toBe(200);
      expect(entered.json.supply).toMatchObject({ outsideDays: days * 4, outsidePills: null, runsOutOn: plus(days * 4) });
    });

    it("does not take a pill quantity for an interval medication", async () => {
      const id = await med(everyDays(14));
      const res = await call("PATCH", `/medications/${id}`, { doseQuantities: { "08:00": 1 } });
      expect(res.status, JSON.stringify(res.json)).toBe(400);
      expect(res.json.error).toBe("quantities_need_scheduled_medication");
    });
  });

  describe("receiving a refill", () => {
    it("takes pills, says what they come to, and keeps the count on the receipt", async () => {
      const id = await med();
      const preview = await call("POST", `/medications/${id}/supply/receive`, { outsidePills: 90, dryRun: true });
      expect(preview.json).toMatchObject({ dryRun: true, outsideDays: 90, runsOutOn: plus(90) });

      const res = await call("POST", `/medications/${id}/supply/receive`, { outsidePills: 90 });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.supply).toMatchObject({ runsOutOn: plus(90), outsidePills: 90 });
      expect((await revisions(id)).map((r) => [r.source, r.outsideQuarters])).toEqual([["receipt", 360]]);
    });

    it("still takes days, and refuses pills without a fixed dose", async () => {
      const id = await med({ over: { scheduleKind: "prn", scheduleJson: "{}" }, q: {} });
      const refused = await call("POST", `/medications/${id}/supply/receive`, { outsidePills: 90 });
      expect(refused.status).toBe(400);
      expect(refused.json.error).toBe("pills_need_fixed_dose");
      const res = await call("POST", `/medications/${id}/supply/receive`, { outsideDays: 90 });
      expect(res.json.supply).toMatchObject({ outsideDays: 90, outsidePills: null });
    });
  });

  describe("a fill taking pills out of the count", () => {
    it("says what the fill used and what that leaves, and changes nothing", async () => {
      const ctx = await sessionFor({}, 7, 60);
      expect(ctx.session.medications[0].countsPills).toBe(true);
      const res = await fill(ctx, ctx.session, { dryRun: true });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json).toEqual({ dryRun: true, pillsUsed: 7, lastCountPills: 60, suggestedOutsidePills: 53 });
      expect((await supplyRow(ctx.medicationId))?.outsideQuarters).toBe(240);
    });

    it("saves the corrected count on top of what is in the organizer, with the preview showing it first", async () => {
      const ctx = await sessionFor({}, 7, 60);
      const preview = await fill(ctx, ctx.session, { outsidePills: 53, dryRun: true });
      expect(preview.json).toMatchObject({ dryRun: true, organizerDays: 7, outsideDays: 53, totalDays: 60, runsOutOn: plus(60) });

      const saved = await fill(ctx, ctx.session, { outsidePills: 50 });
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      expect(saved.json.supply).toMatchObject({ outsideDays: 50, organizerDays: 7, runsOutOn: plus(57) });
      expect((await supplyRow(ctx.medicationId))?.outsideQuarters).toBe(200);
      expect((await revisions(ctx.medicationId)).at(-1)).toMatchObject({ source: "fill", outsideQuarters: 200 });
    });

    it("starts using the pills outside once the organizer runs out, on the real schedule", async () => {
      const ctx = await sessionFor({ days: [todayWeekday()] }, 7); // the organizer holds today's weekly dose
      const saved = await fill(ctx, ctx.session, { outsidePills: 1 });
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      // One pill outside is next week's dose, so nothing is left for the week after.
      expect(saved.json.supply).toMatchObject({ organizerDays: 7, outsideDays: 7, runsOutOn: plus(14) });
    });

    it("does not call a day with no dose a gap in the organizer", async () => {
      const ctx = await sessionFor({ days: [(todayWeekday() + 1) % 7] }, 9); // nothing due today, doses tomorrow and in eight days
      const first = await fill(ctx, ctx.session, { coveredFrom: plus(1), coveredTo: plus(1), outsidePills: 1 });
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      expect(first.json.supply).toMatchObject({ organizerDays: 2, outsideDays: 13, runsOutOn: plus(15) });

      const second = await fill(ctx, first.json.session, { coveredFrom: plus(8), coveredTo: plus(8), outsidePills: 0 });
      expect(second.status, JSON.stringify(second.json)).toBe(200);
      expect(second.json.supply).toMatchObject({ organizerDays: 9, outsideDays: 6, runsOutOn: plus(15) });
    });

    it("takes a whole weekday fill in one save, weekends and all", async () => {
      const ctx = await sessionFor({ days: [(todayWeekday() + 1) % 7] }, 9, 10); // doses tomorrow and in eight days
      const suggestion = await fill(ctx, ctx.session, { coveredFrom: plus(1), coveredTo: plus(8), dryRun: true });
      expect(suggestion.json).toEqual({ dryRun: true, pillsUsed: 2, lastCountPills: 10, suggestedOutsidePills: 8 });

      const saved = await fill(ctx, ctx.session, { coveredFrom: plus(1), coveredTo: plus(8), outsidePills: 8 });
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      expect(saved.json.supply).toMatchObject({ organizerDays: 9 });
      expect(saved.json.session.medications[0]).toMatchObject({ status: "filled", missing: [] });
    });

    it("still asks for the total when a day with a dose really is missing", async () => {
      const ctx = await sessionFor({}, 9);
      const res = await fill(ctx, ctx.session, { coveredFrom: plus(3), coveredTo: plus(4), outsidePills: 5, dryRun: true });
      expect(res.json).toMatchObject({ dryRun: true, needsConfirmation: true });
      const total = await fill(ctx, ctx.session, { coveredFrom: plus(3), coveredTo: plus(4), outsidePills: 5, confirmedTotalDays: 8, dryRun: true });
      expect(total.json).toMatchObject({ dryRun: true, needsConfirmation: false, totalDays: 8, runsOutOn: plus(8) });
    });

    it("only counts days the fill actually adds", async () => {
      const ctx = await sessionFor({}, 7, 60);
      const first = await fill(ctx, ctx.session, { coveredTo: plus(2), outsidePills: 57 });
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      const res = await fill(ctx, first.json.session, { dryRun: true });
      expect(res.json).toEqual({ dryRun: true, pillsUsed: 4, lastCountPills: 57, suggestedOutsidePills: 53 });
    });

    it("stops at nothing when the fill used more than the last count", async () => {
      const ctx = await sessionFor({}, 7, 3);
      const res = await fill(ctx, ctx.session, { dryRun: true });
      expect(res.json).toEqual({ dryRun: true, pillsUsed: 7, lastCountPills: 3, suggestedOutsidePills: 0 });
    });

    it("has no suggestion when there is no count to start from", async () => {
      const ctx = await sessionFor({}, 7);
      const res = await fill(ctx, ctx.session, { dryRun: true });
      expect(res.json).toEqual({ dryRun: true, pillsUsed: 7, lastCountPills: null, suggestedOutsidePills: null });
    });

    it("needs a count or days to actually save", async () => {
      const ctx = await sessionFor({}, 7);
      const res = await fill(ctx, ctx.session, {});
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("invalid_outside_days");
    });

    it("puts the count back when the fill is undone", async () => {
      const ctx = await sessionFor({}, 7, 60);
      const saved = await fill(ctx, ctx.session, { outsidePills: 53 });
      expect((await supplyRow(ctx.medicationId))?.outsideQuarters).toBe(212);
      const undone = await call("POST", `/organizers/${ctx.planId}/sessions/${ctx.session.id}/fills/${saved.json.fill.id}/undo`, { version: saved.json.session.version });
      expect(undone.status, JSON.stringify(undone.json)).toBe(200);
      expect(undone.json.supplyRestored).toBe(true);
      expect((await supplyRow(ctx.medicationId))?.outsideQuarters).toBe(240);
    });

    it("clears a count the undone fill had made first", async () => {
      const ctx = await sessionFor({}, 7);
      const saved = await fill(ctx, ctx.session, { outsidePills: 53 });
      await call("POST", `/organizers/${ctx.planId}/sessions/${ctx.session.id}/fills/${saved.json.fill.id}/undo`, { version: saved.json.session.version });
      expect((await supplyRow(ctx.medicationId))?.outsideQuarters).toBeNull();
    });

    it("counts nothing left when a medication is skipped as out of stock", async () => {
      const ctx = await sessionFor({}, 7, 60);
      const res = await call("POST", `/organizers/${ctx.planId}/sessions/${ctx.session.id}/skips`, { medicationId: ctx.medicationId, reason: "out_of_stock", version: ctx.session.version });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect((await supplyRow(ctx.medicationId))?.outsideQuarters).toBe(0);
    });

    it("leaves dose logs out of it: logging a dose does not change the count", async () => {
      const id = await med();
      await setCount(id, 30);
      const before = await supplyRow(id);
      const logged = await call("POST", `/medications/${id}/log`, { status: "taken", scheduledAt: `${today()}T08:00:00.000Z` });
      expect(logged.status, JSON.stringify(logged.json)).toBeLessThan(300);
      expect(await supplyRow(id)).toMatchObject({ outsideQuarters: before?.outsideQuarters, revision: before?.revision, runsOutOn: before?.runsOutOn });
    });
  });

  it("is kept to the household by row security", async () => {
    const id = await med();
    await setCount(id, 30);
    const seen = await withSystemContext(baseDb, async (tx) => {
      const [other] = await tx.insert(households).values({ name: `${marker}-other`, timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) }).returning({ id: households.id });
      return other.id;
    });
    const scoped = createScopedDb(baseDb);
    const rows = await withHouseholdContext(scoped, seen, (tx) => tx.select().from(healthMedicationSupply).where(and(eq(healthMedicationSupply.medicationId, id))));
    expect(rows).toHaveLength(0);
    await withSystemContext(baseDb, (tx) => tx.delete(households).where(eq(households.id, seen)));
  });
});
