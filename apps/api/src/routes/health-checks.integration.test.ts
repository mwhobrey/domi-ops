import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { mintHealthCheckPushActionToken, mintHealthMedPushActionToken } from "@domi-ops/crypto";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthCheckGroupMembers,
  healthCheckLogs,
  healthCheckPauses,
  healthCheckShares,
  healthChecks,
  healthEvents,
  healthMemberAcl,
  healthVitalsReadings,
  householdMembers,
  households,
  users,
  withHouseholdContext,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { createTenantMiddleware } from "../middleware/tenant.js";
import { buildCheckSlotOverlays } from "../lib/calendar-overlays.js";
import {
  CheckReportRangeError,
  buildBloodPressureReport,
  buildCheckAdherenceReport,
} from "../lib/health-check-reports.js";
import { healthCheckGroupRoutes } from "./health-check-groups.js";
import { householdHealthRoutes } from "./household-health.js";
import { healthCheckRoutes } from "./health-checks.js";

/**
 * WHO-382: scheduled health checks and check groups over HTTP, against a real Postgres. Auth is
 * faked by a parent app that sets `auth` per request from the `x-as` header; everything below it
 * is the real code, including the tenant middleware, so each request runs in a household-scoped
 * RLS transaction exactly like production. Needs migration 0085. Skipped without a database.
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

maybeDescribe("health checks routes (integration)", () => {
  let baseDb: Database;
  let app: Hono<{ Variables: AppVariables }>;
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const people: Record<string, Person> = {};

  async function seedHousehold(
    name: string,
    modules: string[],
    members: { key: string; role: Role }[],
  ): Promise<string> {
    return withSystemContext(baseDb, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name, timezone: "UTC", modulesEnabled: JSON.stringify(modules) })
        .returning({ id: households.id });
      householdIds.push(hh.id);
      for (const m of members) {
        const [u] = await tx
          .insert(users)
          .values({ email: `who382-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
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

  const bp = (overrides: Record<string, unknown> = {}) => ({
    memberId: people.ally!.memberId,
    name: "Ally blood pressure",
    eventType: "vitals",
    template: { metrics: ["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"] },
    schedule: { times: ["08:00", "12:00", "16:00", "20:00"] },
    startDate: "2026-10-02",
    endDate: "2026-10-16",
    ...overrides,
  });

  async function makeCheck(as: string, overrides: Record<string, unknown> = {}): Promise<Json> {
    const res = await call(as, "POST", "/checks", bp(overrides));
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json.check;
  }

  async function makeGroup(as: string, overrides: Record<string, unknown> = {}): Promise<Json> {
    const res = await call(as, "POST", "/check-groups", {
      memberId: people.ally!.memberId,
      name: "Morning",
      schedule: { times: ["08:00"] },
      ...overrides,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json.group;
  }

  const rawCheck = (id: string) =>
    withWorkerScanContext(baseDb, async (tx) => {
      const [row] = await tx.select().from(healthChecks).where(eq(healthChecks.id, id));
      return row;
    });

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);

    const hh = await seedHousehold("who382-home", ["core", "health"], [
      { key: "mom", role: "owner" },
      { key: "dad", role: "admin" },
      { key: "ally", role: "child" },
      { key: "sitter", role: "member" },
      { key: "reader", role: "member" },
      { key: "stranger", role: "member" },
    ]);
    await seedHousehold("who382-other", ["core", "health"], [{ key: "outsider", role: "owner" }]);
    await seedHousehold("who382-nohealth", ["core"], [{ key: "nohealth", role: "owner" }]);

    // sitter may log and manage Ally's events; reader may only see them.
    await withHouseholdContext(baseDb, hh, (tx) =>
      tx.insert(healthMemberAcl).values([
        {
          householdId: hh,
          subjectMemberId: people.ally!.memberId,
          granteeMemberId: people.sitter!.memberId,
          eventsAccess: "write",
        },
        {
          householdId: hh,
          subjectMemberId: people.ally!.memberId,
          granteeMemberId: people.reader!.memberId,
          eventsAccess: "read",
        },
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
          ? {
              userId: who.userId,
              householdId: who.householdId,
              memberId: who.memberId,
              email: null,
              username: null,
              name: null,
              role: who.role,
            }
          : null,
      );
      return next();
    });
    app.use("*", createTenantMiddleware(scoped, env));
    app.route("/checks", healthCheckRoutes(scoped, env));
    app.route("/check-groups", healthCheckGroupRoutes(scoped, env));
    // The events routes, to prove deleting / re-typing a reading unlinks the slots it completed.
    app.route("/health", householdHealthRoutes(scoped, env));
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("creating a check", () => {
    it("creates a four-times-a-day BP check, private by default, with the name encrypted at rest", async () => {
      const check = await makeCheck("mom");
      expect(check).toMatchObject({
        memberId: people.ally!.memberId,
        name: "Ally blood pressure",
        eventType: "vitals",
        template: { metrics: ["blood_pressure_systolic", "blood_pressure_diastolic", "heart_rate"] },
        scheduleKind: "scheduled",
        schedule: { times: ["08:00", "12:00", "16:00", "20:00"] },
        startDate: "2026-10-02",
        endDate: "2026-10-16",
        enabled: true,
        visibility: "private",
        groupIds: [],
        isOwnedByMe: true,
        canEdit: true,
        canLog: true,
      });

      const row = await rawCheck(check.id);
      expect(row!.name.startsWith("enc:v1:")).toBe(true);
      expect(row!.templateJson!.startsWith("enc:v1:")).toBe(true);
      expect(row!.createdByUserId).toBe(people.mom!.userId);
    });

    it("works for every logging group, not just vitals", async () => {
      const pain = await makeCheck("mom", { name: "Pain", eventType: "pain", template: { regions: ["lower_back"] } });
      expect(pain.template).toEqual({ regions: ["lower_back"] });
      const food = await makeCheck("mom", { name: "Meals", eventType: "food_intake", template: undefined });
      expect(food.template).toEqual({});
      const exercise = await makeCheck("mom", {
        name: "Walk",
        eventType: "exercise",
        template: { activity: "Walk" },
        scheduleKind: "interval",
        schedule: { everyMinutes: 240, anchor: "first_taken", stop: { mode: "midnight" } },
      });
      expect(exercise.scheduleKind).toBe("interval");
    });

    it("lets the subject create their own", async () => {
      const check = await makeCheck("ally", { name: "My BP" });
      expect(check.isOwnedByMe).toBe(true);
    });

    it("rejects bad input with a specific error", async () => {
      const bad = async (overrides: Record<string, unknown>, status: number, error: string) => {
        const res = await call("mom", "POST", "/checks", bp(overrides));
        expect({ status: res.status, error: res.json.error }, JSON.stringify(overrides)).toEqual({ status, error });
      };
      await bad({ eventType: "medication" }, 400, "invalid_event_type");
      await bad({ eventType: "nope" }, 400, "invalid_event_type");
      await bad({ template: {} }, 400, "template_requires_metrics");
      await bad({ template: { metrics: ["bogus"] } }, 400, "unknown_vitals_metric");
      await bad({ scheduleKind: "prn" }, 400, "check_schedule_must_be_scheduled_or_interval");
      await bad({ scheduleKind: "otc" }, 400, "check_schedule_must_be_scheduled_or_interval");
      await bad({ schedule: { times: [] } }, 400, "scheduled_checks_require_times");
      await bad({ startDate: "soon" }, 400, "invalid_date");
      await bad({ startDate: "2026-10-16", endDate: "2026-10-02" }, 400, "end_before_start");
      await bad({ name: "   " }, 400, "invalid_body");
      await bad({ name: "x".repeat(201) }, 400, "invalid_body");
      await bad({ memberId: "not-a-uuid" }, 400, "invalid_body");
      await bad({ enabled: "yes" }, 400, "invalid_body");
      await bad({ memberId: randomUUID() }, 404, "member_not_found");
    });

    it("needs events write on the member", async () => {
      expect((await call("stranger", "POST", "/checks", bp())).status).toBe(403);
      expect((await call("reader", "POST", "/checks", bp())).status).toBe(403);
      expect((await call("sitter", "POST", "/checks", bp({ name: "By sitter" }))).status).toBe(201);
      // An admin manages every member's health.
      expect((await call("dad", "POST", "/checks", bp({ name: "By dad" }))).status).toBe(201);
    });

    it("cannot create for a member of another household", async () => {
      const res = await call("outsider", "POST", "/checks", bp());
      expect(res.status).toBe(404);
      expect(res.json.error).toBe("member_not_found");
    });

    it("created paused opens a pause period", async () => {
      const check = await makeCheck("mom", { name: "Paused at birth", enabled: false });
      expect(check.enabled).toBe(false);
      const pauses = await withWorkerScanContext(baseDb, (tx) =>
        tx.select().from(healthCheckPauses).where(eq(healthCheckPauses.checkId, check.id)),
      );
      expect(pauses).toHaveLength(1);
      expect(pauses[0]!.resumedAt).toBeNull();
    });
  });

  describe("who can see a private check", () => {
    it("is the creator, the subject, and ACL grantees: no admin override, no strangers", async () => {
      const check = await makeCheck("mom", { name: "Private BP" });
      const sees = async (as: string) => {
        const list = await call(as, "GET", "/checks");
        const got = await call(as, "GET", `/checks/${check.id}`);
        const inList = (list.json.checks as Json[]).some((c) => c.id === check.id);
        // The list and the single GET must always agree.
        expect(got.status === 200, `${as}: list=${inList} get=${got.status}`).toBe(inList);
        return inList;
      };
      expect(await sees("mom")).toBe(true);
      expect(await sees("ally")).toBe(true);
      expect(await sees("sitter")).toBe(true);
      expect(await sees("reader")).toBe(true);
      expect(await sees("dad")).toBe(false);
      expect(await sees("stranger")).toBe(false);
      expect(await sees("outsider")).toBe(false);
    });

    it("hides existence: writes by someone who cannot see it are 404, not 403", async () => {
      const check = await makeCheck("mom", { name: "Hidden from dad" });
      expect((await call("dad", "PATCH", `/checks/${check.id}`, { name: "x" })).status).toBe(404);
      expect((await call("dad", "DELETE", `/checks/${check.id}`)).status).toBe(404);
      expect((await call("outsider", "PATCH", `/checks/${check.id}`, { name: "x" })).status).toBe(404);
      expect((await call("outsider", "DELETE", `/checks/${check.id}`)).status).toBe(404);
      expect((await rawCheck(check.id))!.deletedAt).toBeNull();
    });

    it("filters the list by member", async () => {
      await makeCheck("mom", { name: "For Ally" });
      const forDad = await makeCheck("mom", { name: "For Dad", memberId: people.dad!.memberId });
      const res = await call("mom", "GET", `/checks?memberId=${people.dad!.memberId}`);
      expect((res.json.checks as Json[]).map((c) => c.id)).toEqual([forDad.id]);
      expect((await call("mom", "GET", "/checks?memberId=nope")).status).toBe(400);
    });
  });

  describe("household visibility is read-only", () => {
    it("lets everyone see it but only creator / events writers change it", async () => {
      const check = await makeCheck("mom", { visibility: "household", name: "Shared BP" });

      const asStranger = await call("stranger", "GET", `/checks/${check.id}`);
      expect(asStranger.status).toBe(200);
      expect(asStranger.json.check).toMatchObject({ canEdit: false, canLog: false });
      // Who a check is shared with is only shown to people who can edit it.
      expect(asStranger.json.check).not.toHaveProperty("sharedMemberIds");
      expect((await call("stranger", "PATCH", `/checks/${check.id}`, { name: "x" })).status).toBe(403);
      expect((await call("stranger", "DELETE", `/checks/${check.id}`)).status).toBe(403);

      const asSitter = await call("sitter", "GET", `/checks/${check.id}`);
      expect(asSitter.json.check).toMatchObject({ canEdit: true, canLog: true });
      expect((await call("sitter", "PATCH", `/checks/${check.id}`, { name: "By sitter" })).status).toBe(200);

      const asReader = await call("reader", "GET", `/checks/${check.id}`);
      expect(asReader.json.check).toMatchObject({ canEdit: false, canLog: false });
    });
  });

  describe("sharing a private check", () => {
    it("shares with household members only, read-only, and clears when made household-visible", async () => {
      const check = await makeCheck("mom", {
        name: "Shared with stranger",
        sharedMemberIds: [people.stranger!.memberId, people.outsider!.memberId, people.mom!.memberId],
      });
      // Other households' members and the creator are filtered out.
      expect(check.sharedMemberIds).toEqual([people.stranger!.memberId]);

      const asStranger = await call("stranger", "GET", `/checks/${check.id}`);
      expect(asStranger.status).toBe(200);
      expect(asStranger.json.check).toMatchObject({ sharedWithMe: true, canEdit: false });
      expect(asStranger.json.check).not.toHaveProperty("sharedMemberIds");
      expect((await call("stranger", "PATCH", `/checks/${check.id}`, { name: "x" })).status).toBe(403);

      const unshared = await call("mom", "PATCH", `/checks/${check.id}`, { sharedMemberIds: [] });
      expect(unshared.json.check.sharedMemberIds).toEqual([]);
      expect((await call("stranger", "GET", `/checks/${check.id}`)).status).toBe(404);

      await call("mom", "PATCH", `/checks/${check.id}`, { sharedMemberIds: [people.stranger!.memberId] });
      await call("mom", "PATCH", `/checks/${check.id}`, { visibility: "household" });
      const shares = await withWorkerScanContext(baseDb, (tx) =>
        tx.select().from(healthCheckShares).where(eq(healthCheckShares.checkId, check.id)),
      );
      expect(shares).toHaveLength(0);
    });
  });

  describe("updating a check", () => {
    it("changes name, template, schedule, offsets and dates", async () => {
      const check = await makeCheck("mom");
      const res = await call("mom", "PATCH", `/checks/${check.id}`, {
        name: "Ally BP (renamed)",
        template: { metrics: ["heart_rate"], title: "Quick BP" },
        schedule: { times: ["09:00", "21:00"], daysOfWeek: [1, 2, 3] },
        reminderOffsets: [0, 10, -5, "x"],
        endDate: null,
      });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.check).toMatchObject({
        name: "Ally BP (renamed)",
        template: { metrics: ["heart_rate"], title: "Quick BP" },
        schedule: { times: ["09:00", "21:00"], daysOfWeek: [1, 2, 3] },
        reminderOffsets: [0, 10],
        startDate: "2026-10-02",
        endDate: null,
      });
    });

    it("validates the merged result", async () => {
      const check = await makeCheck("mom");
      const patch = async (body: unknown) => (await call("mom", "PATCH", `/checks/${check.id}`, body)).json.error;
      expect(await patch({ template: {} })).toBe("template_requires_metrics");
      expect(await patch({ scheduleKind: "prn" })).toBe("check_schedule_must_be_scheduled_or_interval");
      expect(await patch({ endDate: "2026-10-01" })).toBe("end_before_start"); // existing start is 2026-10-02
      expect(await patch({ name: "" })).toBe("invalid_body");
    });

    it("keeps member and event type fixed", async () => {
      const check = await makeCheck("mom");
      const memberRes = await call("mom", "PATCH", `/checks/${check.id}`, { memberId: people.dad!.memberId });
      expect(memberRes.json).toEqual({ error: "immutable_field", field: "memberId" });
      const typeRes = await call("mom", "PATCH", `/checks/${check.id}`, { eventType: "pain" });
      expect(typeRes.json).toEqual({ error: "immutable_field", field: "eventType" });
      // Sending the current value back is fine.
      const same = await call("mom", "PATCH", `/checks/${check.id}`, {
        memberId: people.ally!.memberId,
        eventType: "vitals",
        name: "Same member",
      });
      expect(same.status).toBe(200);
    });

    it("records pause and resume", async () => {
      const check = await makeCheck("mom");
      await call("mom", "PATCH", `/checks/${check.id}`, { enabled: false });
      const open = () =>
        withWorkerScanContext(baseDb, (tx) =>
          tx
            .select()
            .from(healthCheckPauses)
            .where(and(eq(healthCheckPauses.checkId, check.id), isNull(healthCheckPauses.resumedAt))),
        );
      expect(await open()).toHaveLength(1);
      // Re-sending the same value does not open another period.
      await call("mom", "PATCH", `/checks/${check.id}`, { enabled: false });
      expect(await open()).toHaveLength(1);
      await call("mom", "PATCH", `/checks/${check.id}`, { enabled: true });
      expect(await open()).toHaveLength(0);
      const all = await withWorkerScanContext(baseDb, (tx) =>
        tx.select().from(healthCheckPauses).where(eq(healthCheckPauses.checkId, check.id)),
      );
      expect(all).toHaveLength(1);
      expect(all[0]!.resumedAt).not.toBeNull();
    });

    it("answers 404 for ids that are not UUIDs", async () => {
      expect((await call("mom", "GET", "/checks/not-a-uuid")).status).toBe(404);
      expect((await call("mom", "PATCH", "/checks/not-a-uuid", { name: "x" })).status).toBe(404);
      expect((await call("mom", "DELETE", "/checks/not-a-uuid")).status).toBe(404);
    });
  });

  describe("deleting a check", () => {
    it("soft deletes, disables, hides it, and leaves its groups", async () => {
      const check = await makeCheck("mom", { name: "To delete" });
      const group = await makeGroup("mom", { checkIds: [check.id] });
      expect(group.checks.map((c: Json) => c.id)).toEqual([check.id]);

      expect((await call("mom", "DELETE", `/checks/${check.id}`)).status).toBe(200);

      const row = await rawCheck(check.id);
      expect(row!.deletedAt).not.toBeNull();
      expect(row!.enabled).toBe(false);
      expect((await call("mom", "GET", `/checks/${check.id}`)).status).toBe(404);
      const list = await call("mom", "GET", "/checks");
      expect((list.json.checks as Json[]).some((c) => c.id === check.id)).toBe(false);
      expect((await call("mom", "DELETE", `/checks/${check.id}`)).status).toBe(404);

      const memberships = await withWorkerScanContext(baseDb, (tx) =>
        tx.select().from(healthCheckGroupMembers).where(eq(healthCheckGroupMembers.checkId, check.id)),
      );
      expect(memberships).toHaveLength(0);
      const after = await call("mom", "GET", `/check-groups/${group.id}`);
      expect(after.json.group.checks).toEqual([]);
    });
  });

  describe("module and tenant gates", () => {
    it("is off for a household without the health module", async () => {
      const res = await call("nohealth", "GET", "/checks");
      expect(res.status).toBe(403);
      expect(res.json.error).toBe("module_disabled");
      expect((await call("nohealth", "GET", "/check-groups")).status).toBe(403);
    });

    it("rejects unauthenticated callers", async () => {
      expect((await call("nobody", "GET", "/checks")).status).toBe(401);
      expect((await call("nobody", "GET", "/check-groups")).status).toBe(401);
    });
  });

  describe("check groups", () => {
    it("bundles a member's checks and shows them on both sides", async () => {
      const a = await makeCheck("mom", { name: "BP" });
      const b = await makeCheck("mom", { name: "Weight", template: { metrics: ["weight"] } });
      const group = await makeGroup("mom", { name: "Morning vitals", checkIds: [a.id, b.id] });
      expect(group).toMatchObject({
        name: "Morning vitals",
        memberId: people.ally!.memberId,
        scheduleKind: "scheduled",
        schedule: { times: ["08:00"] },
        visibility: "private",
        canEdit: true,
        isOwnedByMe: true,
      });
      expect(group.checks.map((c: Json) => c.id).sort()).toEqual([a.id, b.id].sort());

      const fresh = await call("mom", "GET", `/checks/${a.id}`);
      expect(fresh.json.check.groupIds).toEqual([group.id]);
    });

    it("allows a check in several groups", async () => {
      const check = await makeCheck("mom", { name: "In two groups" });
      const g1 = await makeGroup("mom", { name: "Morning", checkIds: [check.id] });
      const g2 = await makeGroup("mom", { name: "Evening", schedule: { times: ["20:00"] }, checkIds: [check.id] });
      const got = await call("mom", "GET", `/checks/${check.id}`);
      expect((got.json.check.groupIds as string[]).sort()).toEqual([g1.id, g2.id].sort());
    });

    it("only holds checks of the group's own member", async () => {
      const dads = await makeCheck("mom", { name: "Dad's BP", memberId: people.dad!.memberId });
      const group = await makeGroup("mom", { name: "Ally only" });

      const viaMembers = await call("mom", "POST", `/check-groups/${group.id}/members`, { checkId: dads.id });
      expect(viaMembers.status).toBe(400);
      expect(viaMembers.json.error).toBe("member_mismatch");

      const viaCreate = await call("mom", "POST", "/check-groups", {
        memberId: people.ally!.memberId,
        name: "Mixed",
        schedule: { times: ["08:00"] },
        checkIds: [dads.id],
      });
      expect(viaCreate.status).toBe(400);
      expect(viaCreate.json.error).toBe("member_mismatch");

      // Nothing was created by the rejected request.
      const groups = await call("mom", "GET", "/check-groups");
      expect((groups.json.groups as Json[]).some((g) => g.name === "Mixed")).toBe(false);
    });

    it("rejects unknown, deleted and malformed check ids", async () => {
      const gone = await makeCheck("mom", { name: "Gone" });
      await call("mom", "DELETE", `/checks/${gone.id}`);
      for (const ids of [[randomUUID()], [gone.id]]) {
        const res = await call("mom", "POST", "/check-groups", {
          memberId: people.ally!.memberId,
          name: "Bad ids",
          schedule: { times: ["08:00"] },
          checkIds: ids,
        });
        expect({ status: res.status, error: res.json.error }).toEqual({ status: 400, error: "check_not_found" });
      }
      const malformed = await call("mom", "POST", "/check-groups", {
        memberId: people.ally!.memberId,
        name: "Malformed",
        schedule: { times: ["08:00"] },
        checkIds: ["nope"],
      });
      expect(malformed.json.error).toBe("invalid_body");
    });

    it("validates schedules like checks do", async () => {
      const post = async (overrides: Record<string, unknown>) =>
        call("mom", "POST", "/check-groups", {
          memberId: people.ally!.memberId,
          name: "Sched",
          schedule: { times: ["08:00"] },
          ...overrides,
        });
      expect((await post({ scheduleKind: "prn" })).json.error).toBe("check_schedule_must_be_scheduled_or_interval");
      expect((await post({ scheduleKind: "otc" })).json.error).toBe("check_schedule_must_be_scheduled_or_interval");
      expect((await post({ schedule: { times: [] } })).json.error).toBe("scheduled_checks_require_times");
      expect((await post({ startDate: "2026-10-16", endDate: "2026-10-02" })).json.error).toBe("end_before_start");
      expect((await post({ memberId: randomUUID() })).status).toBe(404);
    });

    it("only shows member checks the viewer may see", async () => {
      const hidden = await makeCheck("mom", { name: "Private member" });
      const open = await makeCheck("mom", { name: "Household member", visibility: "household" });
      const group = await makeGroup("mom", { visibility: "household", checkIds: [hidden.id, open.id] });

      const asStranger = await call("stranger", "GET", `/check-groups/${group.id}`);
      expect(asStranger.status).toBe(200);
      expect(asStranger.json.group.checks.map((c: Json) => c.id)).toEqual([open.id]);

      const asMom = await call("mom", "GET", `/check-groups/${group.id}`);
      expect(asMom.json.group.checks).toHaveLength(2);
    });

    it("follows the same write rules as checks", async () => {
      const group = await makeGroup("mom", { visibility: "household", name: "Household group" });
      expect((await call("stranger", "PATCH", `/check-groups/${group.id}`, { name: "x" })).status).toBe(403);
      expect((await call("stranger", "DELETE", `/check-groups/${group.id}`)).status).toBe(403);
      const check = await makeCheck("mom", { visibility: "household", name: "Visible" });
      expect(
        (await call("stranger", "POST", `/check-groups/${group.id}/members`, { checkId: check.id })).status,
      ).toBe(403);

      expect((await call("sitter", "PATCH", `/check-groups/${group.id}`, { name: "By sitter" })).json.group.name).toBe(
        "By sitter",
      );
      expect((await call("outsider", "GET", `/check-groups/${group.id}`)).status).toBe(404);
      expect((await call("outsider", "DELETE", `/check-groups/${group.id}`)).status).toBe(404);

      const privateGroup = await makeGroup("mom", { name: "Private group" });
      expect((await call("dad", "GET", `/check-groups/${privateGroup.id}`)).status).toBe(404);
      expect((await call("stranger", "GET", `/check-groups/${privateGroup.id}`)).status).toBe(404);
    });

    it("updates a group, keeps its member fixed, and adds / removes members", async () => {
      const check = await makeCheck("mom", { name: "Member" });
      const group = await makeGroup("mom", { name: "Original" });

      const patched = await call("mom", "PATCH", `/check-groups/${group.id}`, {
        name: "Renamed",
        schedule: { times: ["07:30", "19:30"] },
        reminderOffsets: [0, 15],
        enabled: false,
      });
      expect(patched.json.group).toMatchObject({
        name: "Renamed",
        schedule: { times: ["07:30", "19:30"] },
        reminderOffsets: [0, 15],
        enabled: false,
      });
      expect((await call("mom", "PATCH", `/check-groups/${group.id}`, { memberId: people.dad!.memberId })).json).toEqual(
        { error: "immutable_field", field: "memberId" },
      );
      expect((await call("mom", "PATCH", `/check-groups/${group.id}`, { scheduleKind: "prn" })).status).toBe(400);

      const added = await call("mom", "POST", `/check-groups/${group.id}/members`, { checkId: check.id });
      expect(added.status).toBe(200);
      expect(added.json.group.checks.map((c: Json) => c.id)).toEqual([check.id]);
      // Adding twice is a no-op, not an error.
      expect((await call("mom", "POST", `/check-groups/${group.id}/members`, { checkId: check.id })).status).toBe(200);

      const removed = await call("mom", "DELETE", `/check-groups/${group.id}/members/${check.id}`);
      expect(removed.status).toBe(200);
      expect(removed.json.group.checks).toEqual([]);
      expect((await call("mom", "DELETE", `/check-groups/${group.id}/members/${check.id}`)).status).toBe(404);
    });

    it("deleting a group leaves its checks alone", async () => {
      const check = await makeCheck("mom", { name: "Survivor" });
      const group = await makeGroup("mom", { checkIds: [check.id] });
      expect((await call("mom", "DELETE", `/check-groups/${group.id}`)).status).toBe(200);
      expect((await call("mom", "GET", `/check-groups/${group.id}`)).status).toBe(404);
      const still = await call("mom", "GET", `/checks/${check.id}`);
      expect(still.status).toBe(200);
      expect(still.json.check.groupIds).toEqual([]);
    });
  });


  describe("sharedMemberIds input", () => {
    // Not an array, not strings, not UUIDs: each used to reach validateHealthShareMemberIds and 500.
    const bad = (): unknown[] => ["abc", {}, 5, [5], ["nope"], [people.stranger!.memberId, "nope"], [null]];

    it("rejects malformed values with 400 on create, for checks and groups", async () => {
      for (const value of bad()) {
        const check = await call("mom", "POST", "/checks", bp({ sharedMemberIds: value }));
        expect({ value, status: check.status, error: check.json?.error }).toEqual({
          value,
          status: 400,
          error: "invalid_body",
        });
        const group = await call("mom", "POST", "/check-groups", {
          memberId: people.ally!.memberId,
          name: "Bad shares",
          schedule: { times: ["08:00"] },
          sharedMemberIds: value,
        });
        expect({ value, status: group.status, error: group.json?.error }).toEqual({
          value,
          status: 400,
          error: "invalid_body",
        });
      }
      // Nothing was created by the rejected requests.
      const list = await call("mom", "GET", "/check-groups");
      expect((list.json.groups as Json[]).some((g) => g.name === "Bad shares")).toBe(false);
    });

    it("rejects malformed values with 400 on update, before changing anything", async () => {
      const check = await makeCheck("mom", { name: "Untouched check" });
      const group = await makeGroup("mom", { name: "Untouched group" });
      for (const value of bad()) {
        const onCheck = await call("mom", "PATCH", `/checks/${check.id}`, {
          name: "Changed",
          enabled: false,
          sharedMemberIds: value,
        });
        expect({ value, status: onCheck.status, error: onCheck.json?.error }).toEqual({
          value,
          status: 400,
          error: "invalid_body",
        });
        const onGroup = await call("mom", "PATCH", `/check-groups/${group.id}`, {
          name: "Changed",
          enabled: false,
          sharedMemberIds: value,
        });
        expect({ value, status: onGroup.status, error: onGroup.json?.error }).toEqual({
          value,
          status: 400,
          error: "invalid_body",
        });
      }

      // The rejected requests wrote nothing: not the name, not enabled, not a pause period.
      const freshCheck = (await call("mom", "GET", `/checks/${check.id}`)).json.check;
      expect(freshCheck).toMatchObject({ name: "Untouched check", enabled: true });
      const freshGroup = (await call("mom", "GET", `/check-groups/${group.id}`)).json.group;
      expect(freshGroup).toMatchObject({ name: "Untouched group", enabled: true });
      const pauses = await withWorkerScanContext(baseDb, (tx) =>
        tx.select().from(healthCheckPauses).where(eq(healthCheckPauses.checkId, check.id)),
      );
      expect(pauses).toHaveLength(0);
    });

    it("still accepts an empty list and valid ids", async () => {
      const check = await makeCheck("mom", { name: "Shares ok" });
      const cleared = await call("mom", "PATCH", `/checks/${check.id}`, { sharedMemberIds: [] });
      expect(cleared.status).toBe(200);
      const shared = await call("mom", "PATCH", `/checks/${check.id}`, {
        sharedMemberIds: [people.stranger!.memberId],
      });
      expect(shared.json.check.sharedMemberIds).toEqual([people.stranger!.memberId]);

      const group = await makeGroup("mom", { name: "Shares ok group", sharedMemberIds: [people.stranger!.memberId] });
      expect(group.sharedMemberIds).toEqual([people.stranger!.memberId]);
      const groupCleared = await call("mom", "PATCH", `/check-groups/${group.id}`, { sharedMemberIds: [] });
      expect(groupCleared.status).toBe(200);
    });
  });


  describe("logging a slot (WHO-383)", () => {
    const slot = "2026-10-02T12:00:00.000Z";

    async function makeEvent(memberKey: string, type: "vitals" | "pain" = "vitals", createdBy = "mom") {
      const [row] = await withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        tx
          .insert(healthEvents)
          .values({
            householdId: people.mom!.householdId,
            memberId: people[memberKey]!.memberId,
            type,
            title: "who383 reading",
            startedAt: new Date(slot),
            createdByUserId: people[createdBy]!.userId,
          })
          .returning({ id: healthEvents.id }),
      );
      return row!.id;
    }

    const log = (as: string, checkId: string, body: unknown) => call(as, "POST", `/checks/${checkId}/log`, body);

    const rowsFor = (checkId: string) =>
      withWorkerScanContext(baseDb, (tx) =>
        tx.select().from(healthCheckLogs).where(eq(healthCheckLogs.checkId, checkId)),
      );

    it("links an event to the slot and marks it done", async () => {
      const check = await makeCheck("mom");
      const eventId = await makeEvent("ally");
      const res = await log("mom", check.id, { scheduledAt: slot, eventId, notes: "after a walk" });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      expect(res.json.outcome).toBe("inserted");
      expect(res.json.log).toMatchObject({
        checkId: check.id,
        scheduledAt: slot,
        status: "done",
        healthEventId: eventId,
        notes: "after a walk",
        loggedByUserId: people.mom!.userId,
      });
      const [row] = await rowsFor(check.id);
      expect(row!.notes!.startsWith("enc:v1:")).toBe(true);
    });

    it("logging the same slot again replaces the answer: Skip, then Done", async () => {
      const check = await makeCheck("mom");
      const eventId = await makeEvent("ally");
      expect((await log("mom", check.id, { scheduledAt: slot, status: "skipped" })).json.log.status).toBe("skipped");
      const done = await log("mom", check.id, { scheduledAt: slot, eventId });
      expect(done.status).toBe(200);
      expect(done.json.outcome).toBe("updated");
      expect(done.json.log).toMatchObject({ status: "done", healthEventId: eventId });
      expect(await rowsFor(check.id)).toHaveLength(1);
    });

    it("skips a slot without an event, and treats 12:00:07 as the 12:00 slot", async () => {
      const check = await makeCheck("mom");
      const skipped = await log("mom", check.id, { scheduledAt: "2026-10-02T12:00:07.250Z", status: "skipped" });
      expect(skipped.status).toBe(201);
      expect(skipped.json.log).toMatchObject({ status: "skipped", healthEventId: null, scheduledAt: slot });
      const again = await log("mom", check.id, { scheduledAt: slot, status: "skipped" });
      expect(again.json.outcome).toBe("updated");
      expect(await rowsFor(check.id)).toHaveLength(1);
    });

    it("validates the request", async () => {
      const check = await makeCheck("mom");
      const eventId = await makeEvent("ally");
      const bad = async (body: unknown, status: number, error: string) => {
        const res = await log("mom", check.id, body);
        expect({ status: res.status, error: res.json?.error }, JSON.stringify(body)).toEqual({ status, error });
      };
      await bad({}, 400, "invalid_scheduled_at");
      await bad({ scheduledAt: "noon" }, 400, "invalid_scheduled_at");
      await bad({ scheduledAt: "2026-13-45T99:00:00Z" }, 400, "invalid_scheduled_at");
      await bad({ scheduledAt: 5 }, 400, "invalid_scheduled_at");
      await bad({ scheduledAt: slot, status: "missed", eventId }, 400, "invalid_status");
      await bad({ scheduledAt: slot, status: "taken" }, 400, "invalid_status");
      await bad({ scheduledAt: slot, eventId: "nope" }, 400, "invalid_body");
      await bad({ scheduledAt: slot, eventId, notes: 5 }, 400, "invalid_body");
      await bad({ scheduledAt: slot, eventId, notes: "x".repeat(2001) }, 400, "invalid_body");
      // Done needs an event; skipping must not carry one.
      await bad({ scheduledAt: slot }, 400, "event_required");
      await bad({ scheduledAt: slot, status: "skipped", eventId }, 400, "event_not_allowed");
      expect(await rowsFor(check.id)).toHaveLength(0);
    });

    it("only accepts an event that could have completed the check", async () => {
      const check = await makeCheck("mom");
      // The wrong kind of entry: a pain entry cannot complete a vitals check.
      const pain = await makeEvent("ally", "pain");
      expect((await log("mom", check.id, { scheduledAt: slot, eventId: pain })).json.error).toBe("event_type_mismatch");
      // Someone else's reading, visible to mom (she created it).
      const moms = await makeEvent("mom");
      expect((await log("mom", check.id, { scheduledAt: slot, eventId: moms })).json.error).toBe("event_member_mismatch");
      expect((await log("mom", check.id, { scheduledAt: slot, eventId: randomUUID() })).json.error).toBe("event_not_found");
      expect(await rowsFor(check.id)).toHaveLength(0);
    });

    it("cannot link an event the caller cannot see, and does not reveal it exists", async () => {
      const check = await makeCheck("mom");
      // A private reading about mom, created by mom: the sitter (events write on Ally only) cannot see it.
      const moms = await makeEvent("mom");
      const res = await log("sitter", check.id, { scheduledAt: slot, eventId: moms });
      expect({ status: res.status, error: res.json.error }).toEqual({ status: 404, error: "event_not_found" });
      expect(await rowsFor(check.id)).toHaveLength(0);
    });

    it("one reading completes one slot of a check, but may complete other checks", async () => {
      const bpCheck = await makeCheck("mom", { name: "BP" });
      const weightCheck = await makeCheck("mom", { name: "Weight", template: { metrics: ["weight"] } });
      const eventId = await makeEvent("ally");
      expect((await log("mom", bpCheck.id, { scheduledAt: slot, eventId })).status).toBe(201);
      const second = await log("mom", bpCheck.id, { scheduledAt: "2026-10-02T16:00:00.000Z", eventId });
      expect({ status: second.status, error: second.json.error }).toEqual({ status: 409, error: "event_already_used" });
      expect((await log("mom", weightCheck.id, { scheduledAt: slot, eventId })).status).toBe(201);
    });

    it("counts however early or late the reading was taken", async () => {
      const check = await makeCheck("mom");
      const [yesterday] = await withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        tx
          .insert(healthEvents)
          .values({
            householdId: people.mom!.householdId,
            memberId: people.ally!.memberId,
            type: "vitals",
            title: "who383 yesterday",
            startedAt: new Date("2026-10-01T07:41:00.000Z"),
            createdByUserId: people.mom!.userId,
          })
          .returning({ id: healthEvents.id }),
      );
      const res = await log("mom", check.id, { scheduledAt: slot, eventId: yesterday!.id });
      expect(res.status).toBe(201);
      expect(res.json.log.status).toBe("done");
    });

    it("needs events write on the person, and visibility of the check", async () => {
      const check = await makeCheck("mom");
      const eventId = await makeEvent("ally");
      // Can see it, cannot log it.
      expect((await log("reader", check.id, { scheduledAt: slot, status: "skipped" })).status).toBe(403);
      // Cannot see it at all: 404, not 403. An admin without a grant gets no override.
      expect((await log("dad", check.id, { scheduledAt: slot, status: "skipped" })).status).toBe(404);
      expect((await log("stranger", check.id, { scheduledAt: slot, status: "skipped" })).status).toBe(404);
      expect((await log("outsider", check.id, { scheduledAt: slot, status: "skipped" })).status).toBe(404);
      expect(await rowsFor(check.id)).toHaveLength(0);
      // The subject and an events writer can.
      expect((await log("ally", check.id, { scheduledAt: slot, eventId })).status).toBe(201);
      expect((await log("sitter", check.id, { scheduledAt: slot, status: "skipped" })).status).toBe(200);
    });

    it("a household-visible check is loggable only by people who may write the person's events", async () => {
      const check = await makeCheck("mom", { visibility: "household" });
      expect((await log("stranger", check.id, { scheduledAt: slot, status: "skipped" })).status).toBe(403);
      expect((await log("sitter", check.id, { scheduledAt: slot, status: "skipped" })).status).toBe(201);
    });

    it("cannot log a deleted check", async () => {
      const check = await makeCheck("mom");
      await call("mom", "DELETE", `/checks/${check.id}`);
      expect((await log("mom", check.id, { scheduledAt: slot, status: "skipped" })).status).toBe(404);
      expect((await log("mom", "not-a-uuid", { scheduledAt: slot, status: "skipped" })).status).toBe(404);
    });
  });


  describe("slot status (WHO-384)", () => {
    // A Monday long ago (everything is overdue) and one far ahead (everything is upcoming), so the
    // real clock cannot change the answers. Household time zone is UTC.
    const PAST = "2025-03-03";
    const FUTURE = "2099-03-02";
    const BP = ["blood_pressure_systolic", "blood_pressure_diastolic"];

    // A reading left by an earlier test could be nearer a slot than this test's own, and win.
    beforeEach(async () => {
      await withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        tx.delete(healthEvents).where(like(healthEvents.title, "who384%")),
      );
    });

    const slotsFor = async (as: string, checkId: string, query: string, headers: Record<string, string> = {}) => {
      const res = await app.request(`/checks/slots?checkId=${checkId}&${query}`, {
        headers: { "x-as": as, ...headers },
      });
      const json = (await res.json()) as Json;
      return { status: res.status, json, slots: (json?.checks?.[0]?.slots ?? []) as Json[] };
    };
    const compact = (slots: Json[]) => slots.map((x) => `${String(x.scheduledAt).slice(11, 16)} ${x.status}`);

    async function makeBpCheck(over: Record<string, unknown> = {}) {
      return makeCheck("mom", {
        name: "Slots BP",
        startDate: null,
        endDate: null,
        template: { metrics: BP },
        schedule: { times: ["08:00", "12:00"] },
        ...over,
      });
    }

    async function readingAt(iso: string, metrics: string[] = BP, type: "vitals" | "pain" = "vitals") {
      const [row] = await withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
        const [ev] = await tx
          .insert(healthEvents)
          .values({
            householdId: people.mom!.householdId,
            memberId: people.ally!.memberId,
            type,
            title: "who384 reading",
            startedAt: new Date(iso),
            createdByUserId: people.mom!.userId, // private, so only mom (its creator) and Ally's ACL grantees can open it
          })
          .returning({ id: healthEvents.id });
        for (const metric of metrics) {
          await tx.insert(healthVitalsReadings).values({ eventId: ev!.id, metric: metric as never, value: "1", unit: "x" });
        }
        return [ev!];
      });
      return row!.id;
    }

    it("is not mistaken for a check id", async () => {
      const check = await makeBpCheck();
      const res = await slotsFor("mom", check.id, `from=${PAST}&to=${PAST}`);
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ timeZone: "UTC", from: PAST, to: PAST });
      expect(res.json.checks).toHaveLength(1);
    });

    it("validates the request", async () => {
      const bad = async (query: string, error: string) => {
        const res = await call("mom", "GET", `/checks/slots?${query}`);
        expect({ query, status: res.status, error: res.json?.error }).toEqual({ query, status: 400, error });
      };
      await bad("from=soon", "invalid_date");
      await bad(`from=${PAST}&to=2025-02-30`, "invalid_date");
      await bad(`from=${PAST}&to=2025-03-01`, "end_before_start");
      await bad(`from=${PAST}&to=2025-05-01`, "range_too_large");
      await bad("memberId=nope", "invalid_member");
      await bad("checkId=nope", "invalid_check");
    });

    it("reports a past day as overdue and a future day as upcoming", async () => {
      const check = await makeBpCheck();
      expect(compact((await slotsFor("mom", check.id, `from=${PAST}&to=${PAST}`)).slots)).toEqual(["08:00 overdue", "12:00 overdue"]);
      expect(compact((await slotsFor("mom", check.id, `from=${FUTURE}&to=${FUTURE}`)).slots)).toEqual(["08:00 upcoming", "12:00 upcoming"]);
    });

    it("a reading logged outside the check completes the slot it is near, checking its metrics", async () => {
      const check = await makeBpCheck();
      await readingAt(`${PAST}T12:10:00.000Z`);
      await readingAt(`${PAST}T08:05:00.000Z`, ["weight"]); // weight only: not a blood pressure
      const res = await slotsFor("mom", check.id, `from=${PAST}&to=${PAST}`);
      expect(compact(res.slots)).toEqual(["08:00 overdue", "12:00 done"]);
      expect(res.slots[1]).toMatchObject({ source: "event", logId: null });
      expect(res.slots[1].eventId).toBeTruthy();
    });

    it("a slot answered through the log endpoint counts, and a skip stays a skip", async () => {
      const check = await makeBpCheck();
      const far = await readingAt(`${PAST}T03:00:00.000Z`);
      await call("mom", "POST", `/checks/${check.id}/log`, { scheduledAt: `${PAST}T08:00:00.000Z`, eventId: far });
      await call("mom", "POST", `/checks/${check.id}/log`, { scheduledAt: `${PAST}T12:00:00.000Z`, status: "skipped" });
      await readingAt(`${PAST}T12:02:00.000Z`); // would complete 12:00, but it was skipped on purpose
      const res = await slotsFor("mom", check.id, `from=${PAST}&to=${PAST}`);
      expect(compact(res.slots)).toEqual(["08:00 done", "12:00 skipped"]);
      expect(res.slots[0]).toMatchObject({ source: "log", eventId: far });
      expect(res.slots[1]).toMatchObject({ source: "log", eventId: null });
    });

    it("only names entries the caller may open, but still reports the slot as done", async () => {
      const check = await makeBpCheck({ visibility: "household" });
      const reading = await readingAt(`${PAST}T12:10:00.000Z`);
      // mom created it; the sitter has events access to Ally; the stranger can see the check only.
      expect((await slotsFor("mom", check.id, `from=${PAST}&to=${PAST}`)).slots[1].eventId).toBe(reading);
      expect((await slotsFor("sitter", check.id, `from=${PAST}&to=${PAST}`)).slots[1].eventId).toBe(reading);
      const asStranger = await slotsFor("stranger", check.id, `from=${PAST}&to=${PAST}`);
      expect(compact(asStranger.slots)).toEqual(["08:00 overdue", "12:00 done"]);
      expect(asStranger.slots[1]).toMatchObject({ source: "event", eventId: null });
    });

    it("lays the day out in the caller's time zone", async () => {
      const check = await makeBpCheck({ schedule: { times: ["08:00"] } });
      const utc = await slotsFor("mom", check.id, `from=${PAST}&to=${PAST}`);
      expect(utc.slots[0].scheduledAt).toBe(`${PAST}T08:00:00.000Z`);
      const chicago = await slotsFor("mom", check.id, `from=${PAST}&to=${PAST}`, { "x-client-timezone": "America/Chicago" });
      expect(chicago.json.timeZone).toBe("America/Chicago");
      expect(chicago.slots[0].scheduledAt).toBe(`${PAST}T14:00:00.000Z`); // CST, UTC-6, in early March
      // A garbage zone falls back to the household's.
      const junk = await slotsFor("mom", check.id, `from=${PAST}&to=${PAST}`, { "x-client-timezone": "Not/AZone" });
      expect(junk.json.timeZone).toBe("UTC");
    });

    it("has no slots while a check is paused", async () => {
      const paused = await makeBpCheck({ enabled: false });
      expect((await slotsFor("mom", paused.id, `from=${FUTURE}&to=${FUTURE}`)).slots).toEqual([]);
      await call("mom", "PATCH", `/checks/${paused.id}`, { enabled: true });
      expect(compact((await slotsFor("mom", paused.id, `from=${FUTURE}&to=${FUTURE}`)).slots)).toEqual(["08:00 upcoming", "12:00 upcoming"]);
    });

    it("only covers checks the caller can see, and skips deleted ones", async () => {
      const check = await makeBpCheck();
      const idsFor = async (as: string) =>
        ((await call(as, "GET", `/checks/slots?from=${PAST}&to=${PAST}`)).json.checks as Json[]).map((c) => c.checkId);
      expect(await idsFor("mom")).toContain(check.id);
      expect(await idsFor("ally")).toContain(check.id);
      expect(await idsFor("sitter")).toContain(check.id);
      expect(await idsFor("dad")).not.toContain(check.id); // an admin with no grant sees no private check
      expect(await idsFor("stranger")).not.toContain(check.id);
      expect(await idsFor("outsider")).not.toContain(check.id);

      await call("mom", "DELETE", `/checks/${check.id}`);
      expect(await idsFor("mom")).not.toContain(check.id);
    });

    it("filters by member", async () => {
      const forDad = await makeBpCheck({ memberId: people.dad!.memberId, name: "Dad slots" });
      const res = await call("mom", "GET", `/checks/slots?from=${PAST}&to=${PAST}&memberId=${people.dad!.memberId}`);
      const checks = res.json.checks as Json[];
      expect(checks.map((c) => c.checkId)).toContain(forDad.id);
      // Every check returned is Dad's, and none of Ally's.
      expect(checks.every((c) => c.memberId === people.dad!.memberId)).toBe(true);
    });

    it("needs the health module and a signed-in caller", async () => {
      expect((await call("nohealth", "GET", `/checks/slots?from=${PAST}&to=${PAST}`)).status).toBe(403);
      expect((await call("nobody", "GET", `/checks/slots?from=${PAST}&to=${PAST}`)).status).toBe(401);
    });
  });


  describe("undo and edit a logged slot (WHO-385)", () => {
    const DAY = "2025-04-07"; // a Monday long ago, so every unanswered slot is overdue
    const slot = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

    beforeEach(async () => {
      await withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        tx.delete(healthEvents).where(like(healthEvents.title, "who385%")),
      );
    });

    async function reading(at: string, memberKey = "ally") {
      const [row] = await withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
        const [ev] = await tx
          .insert(healthEvents)
          .values({
            householdId: people.mom!.householdId,
            memberId: people[memberKey]!.memberId,
            type: "vitals",
            title: "who385 reading",
            startedAt: new Date(at),
            createdByUserId: people.mom!.userId,
          })
          .returning({ id: healthEvents.id });
        for (const metric of ["blood_pressure_systolic", "blood_pressure_diastolic"]) {
          await tx.insert(healthVitalsReadings).values({ eventId: ev!.id, metric: metric as never, value: "1", unit: "x" });
        }
        return [ev!];
      });
      return row!.id;
    }
    const bpCheck = (over: Record<string, unknown> = {}) =>
      makeCheck("mom", {
        name: "385 BP",
        startDate: null,
        endDate: null,
        template: { metrics: ["blood_pressure_systolic", "blood_pressure_diastolic"] },
        schedule: { times: ["08:00", "12:00"] },
        ...over,
      });
    const logSlot = async (as: string, checkId: string, body: unknown) => {
      const res = await call(as, "POST", `/checks/${checkId}/log`, body);
      expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
      return res.json.log;
    };
    const status = async (as: string, checkId: string) => {
      const res = await app.request(`/checks/slots?checkId=${checkId}&from=${DAY}&to=${DAY}`, { headers: { "x-as": as } });
      const json = (await res.json()) as Json;
      return (json.checks[0]?.slots as Json[]).map((x) => `${String(x.scheduledAt).slice(11, 16)} ${x.status}`);
    };
    const eventStatus = async (id: string) => (await call("mom", "GET", `/health/events/${id}`)).status;
    const rawLogs = (checkId: string) =>
      withWorkerScanContext(baseDb, (tx) => tx.select().from(healthCheckLogs).where(eq(healthCheckLogs.checkId, checkId)));

    it("undo reopens the slot and keeps the reading", async () => {
      const check = await bpCheck();
      const eventId = await reading(slot("03:00")); // far from either slot: only a link can complete one
      const done = await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId });
      expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 done"]);

      const res = await call("mom", "DELETE", `/checks/${check.id}/logs/${done.id}`);
      expect(res.json).toEqual({ ok: true, deletedEvent: false });
      expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 overdue"]);
      expect(await eventStatus(eventId)).toBe(200);
      expect(await rawLogs(check.id)).toHaveLength(0);
    });

    it("undo can delete the reading too, unless another check relies on it", async () => {
      const check = await bpCheck();
      const other = await bpCheck({ name: "385 BP twin" });
      const solo = await reading(slot("03:00"));
      const soloLog = await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId: solo });
      const res = await call("sitter", "DELETE", `/checks/${check.id}/logs/${soloLog.id}?deleteEvent=true`);
      expect(res.json).toEqual({ ok: true, deletedEvent: true });
      expect(await eventStatus(solo)).toBe(404);

      const both = await reading(slot("04:00"));
      const first = await logSlot("mom", check.id, { scheduledAt: slot("08:00"), eventId: both });
      await logSlot("mom", other.id, { scheduledAt: slot("08:00"), eventId: both });
      const blocked = await call("mom", "DELETE", `/checks/${check.id}/logs/${first.id}?deleteEvent=true`);
      expect({ status: blocked.status, error: blocked.json.error }).toEqual({ status: 409, error: "event_in_use" });
      // Nothing changed.
      expect(await rawLogs(check.id)).toHaveLength(1);
      expect(await eventStatus(both)).toBe(200);
    });

    it("edits done to skipped and back, and the slots follow", async () => {
      const check = await bpCheck();
      const eventId = await reading(slot("03:00"));
      const done = await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId });

      const skipped = await call("mom", "PATCH", `/checks/${check.id}/logs/${done.id}`, { status: "skipped" });
      expect(skipped.json).toMatchObject({ outcome: "updated", log: { status: "skipped", healthEventId: null } });
      expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 skipped"]);
      expect(await eventStatus(eventId)).toBe(200); // the reading is untouched

      const again = await call("mom", "PATCH", `/checks/${check.id}/logs/${done.id}`, { status: "done", eventId });
      expect(again.json.log).toMatchObject({ status: "done", healthEventId: eventId });
      expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 done"]);
    });

    it("moves a log to another slot, and refuses a slot that is taken", async () => {
      const check = await bpCheck();
      const a = await logSlot("mom", check.id, { scheduledAt: slot("08:00"), status: "skipped" });
      await logSlot("mom", check.id, { scheduledAt: slot("12:00"), status: "skipped" });
      const taken = await call("mom", "PATCH", `/checks/${check.id}/logs/${a.id}`, { scheduledAt: slot("12:00") });
      expect({ status: taken.status, error: taken.json.error }).toEqual({ status: 409, error: "slot_taken" });

      await call("mom", "DELETE", `/checks/${check.id}/logs/${(await rawLogs(check.id)).find((l) => l.scheduledAt.toISOString() === slot("12:00"))!.id}`);
      const moved = await call("mom", "PATCH", `/checks/${check.id}/logs/${a.id}`, { scheduledAt: `${DAY}T12:00:41.000Z` });
      expect(moved.json.log.scheduledAt).toBe(slot("12:00"));
      expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 skipped"]);
    });

    it("edits the note", async () => {
      const check = await bpCheck();
      const l = await logSlot("mom", check.id, { scheduledAt: slot("08:00"), status: "skipped" });
      const res = await call("mom", "PATCH", `/checks/${check.id}/logs/${l.id}`, { notes: "slept in" });
      expect(res.json.log.notes).toBe("slept in");
      expect((await call("mom", "PATCH", `/checks/${check.id}/logs/${l.id}`, { notes: null })).json.log.notes).toBeNull();
    });

    it("validates the edit", async () => {
      const check = await bpCheck();
      const eventId = await reading(slot("03:00"));
      const l = await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId });
      const patch = async (body: unknown, status: number, error: string) => {
        const res = await call("mom", "PATCH", `/checks/${check.id}/logs/${l.id}`, body);
        expect({ status: res.status, error: res.json?.error }, JSON.stringify(body)).toEqual({ status, error });
      };
      await patch({}, 400, "invalid_body");
      await patch({ status: "missed" }, 400, "invalid_status");
      await patch({ status: "taken" }, 400, "invalid_status");
      await patch({ eventId: "nope" }, 400, "invalid_body");
      await patch({ notes: 5 }, 400, "invalid_body");
      await patch({ notes: "x".repeat(2001) }, 400, "invalid_body");
      await patch({ scheduledAt: "noon" }, 400, "invalid_scheduled_at");
      await patch({ eventId: null }, 400, "event_required");
      await patch({ status: "skipped", eventId }, 400, "event_not_allowed");
      await patch({ eventId: randomUUID() }, 404, "event_not_found");
      const wrongKind = await readingOfType("pain");
      await patch({ eventId: wrongKind }, 400, "event_type_mismatch");
      expect((await rawLogs(check.id))[0]!.status).toBe("done");

      async function readingOfType(type: "pain") {
        const [row] = await withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
          tx
            .insert(healthEvents)
            .values({
              householdId: people.mom!.householdId,
              memberId: people.ally!.memberId,
              type,
              title: "who385 pain",
              startedAt: new Date(slot("12:00")),
              createdByUserId: people.mom!.userId,
            })
            .returning({ id: healthEvents.id }),
        );
        return row!.id;
      }
    });

    it("needs events write on the person and sight of the check, like logging does", async () => {
      const check = await bpCheck();
      const l = await logSlot("mom", check.id, { scheduledAt: slot("12:00"), status: "skipped" });
      const base = `/checks/${check.id}/logs/${l.id}`;
      for (const [as, expected] of [["reader", 403], ["dad", 404], ["stranger", 404], ["outsider", 404]] as const) {
        expect((await call(as, "PATCH", base, { notes: "x" })).status, `PATCH as ${as}`).toBe(expected);
        expect((await call(as, "DELETE", base)).status, `DELETE as ${as}`).toBe(expected);
      }
      expect(await rawLogs(check.id)).toHaveLength(1);
      expect((await call("sitter", "PATCH", base, { notes: "by sitter" })).status).toBe(200);
      expect((await call("ally", "DELETE", base)).status).toBe(200);
    });

    it("cannot reach a log through the wrong check, a bad id, or a deleted check", async () => {
      const check = await bpCheck();
      const other = await bpCheck({ name: "385 other" });
      const l = await logSlot("mom", check.id, { scheduledAt: slot("12:00"), status: "skipped" });
      expect((await call("mom", "PATCH", `/checks/${other.id}/logs/${l.id}`, { notes: "x" })).status).toBe(404);
      expect((await call("mom", "DELETE", `/checks/${other.id}/logs/${l.id}`)).status).toBe(404);
      expect((await call("mom", "PATCH", `/checks/${check.id}/logs/not-a-uuid`, { notes: "x" })).status).toBe(404);
      expect((await call("mom", "DELETE", `/checks/${check.id}/logs/${randomUUID()}`)).status).toBe(404);

      await call("mom", "DELETE", `/checks/${check.id}`);
      expect((await call("mom", "PATCH", `/checks/${check.id}/logs/${l.id}`, { notes: "x" })).status).toBe(404);
      expect((await call("mom", "DELETE", `/checks/${check.id}/logs/${l.id}`)).status).toBe(404);
      // History survives a soft delete: the log is still there for reports.
      expect(await rawLogs(check.id)).toHaveLength(1);
    });

    it("pausing and resuming keeps the logs", async () => {
      const check = await bpCheck();
      await logSlot("mom", check.id, { scheduledAt: slot("12:00"), status: "skipped" });
      await call("mom", "PATCH", `/checks/${check.id}`, { enabled: false });
      await call("mom", "PATCH", `/checks/${check.id}`, { enabled: true });
      expect(await rawLogs(check.id)).toHaveLength(1);
      expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 skipped"]);
    });

    describe("when the reading it points at changes", () => {
      it("deleting the reading reopens the slot instead of leaving a done slot with nothing behind it", async () => {
        const check = await bpCheck();
        const eventId = await reading(slot("03:00"));
        await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId });
        expect((await call("mom", "DELETE", `/health/events/${eventId}`)).status).toBe(200);
        expect(await rawLogs(check.id)).toHaveLength(0);
        expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 overdue"]);
      });

      it("re-typing the reading stops it completing the slot", async () => {
        const check = await bpCheck();
        const eventId = await reading(slot("03:00"));
        await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId });
        expect((await call("mom", "PATCH", `/health/events/${eventId}`, { type: "pain" })).status).toBe(200);
        expect(await rawLogs(check.id)).toHaveLength(0);
        expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 overdue"]);
      });

      it("handing the reading to someone else stops it completing the slot", async () => {
        const check = await bpCheck();
        const eventId = await reading(slot("03:00"));
        await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId });
        expect((await call("mom", "PATCH", `/health/events/${eventId}`, { memberId: people.dad!.memberId })).status).toBe(200);
        expect(await rawLogs(check.id)).toHaveLength(0);
      });

      it("editing something else about the reading leaves the slot done", async () => {
        const check = await bpCheck();
        const eventId = await reading(slot("03:00"));
        await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId });
        expect((await call("mom", "PATCH", `/health/events/${eventId}`, { title: "renamed", type: "vitals" })).status).toBe(200);
        expect(await rawLogs(check.id)).toHaveLength(1);
        expect(await status("mom", check.id)).toEqual(["08:00 overdue", "12:00 done"]);
      });

      it("skipped slots are not touched by event changes", async () => {
        const check = await bpCheck();
        const eventId = await reading(slot("03:00"));
        await logSlot("mom", check.id, { scheduledAt: slot("08:00"), status: "skipped" });
        await logSlot("mom", check.id, { scheduledAt: slot("12:00"), eventId });
        await call("mom", "DELETE", `/health/events/${eventId}`);
        expect((await rawLogs(check.id)).map((l) => l.status)).toEqual(["skipped"]);
      });
    });
  });

  describe("skipping a slot from a push notification (WHO-388)", () => {
    const DAYX = "2026-10-02";
    const BP = ["blood_pressure_systolic", "blood_pressure_diastolic"];
    const at = (hhmm: string) => `${DAYX}T${hhmm}:00.000Z`;
    const secret = env.ENCRYPTION_KEY as string;

    const pushCheck = (over: Record<string, unknown> = {}) =>
      makeCheck("mom", {
        name: "388 BP",
        startDate: null,
        endDate: null,
        template: { metrics: BP },
        schedule: { times: ["08:00", "12:00"] },
        ...over,
      });
    const tokenFor = (userKey: string, checkId: string, hhmm = "12:00", nowMs?: number) =>
      mintHealthCheckPushActionToken(
        { householdId: people[userKey]!.householdId, userId: people[userKey]!.userId, checkId, scheduledAt: at(hhmm) },
        secret,
        nowMs,
      );
    /** No x-as header: like the service worker with no usable session. */
    const push = async (body: unknown) => {
      const res = await app.request("/health/checks/push-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
    };
    const skip = (token: string, extra: Record<string, unknown> = {}) => push({ token, action: "skip", ...extra });
    const rows = (checkId: string) =>
      withWorkerScanContext(baseDb, (tx) => tx.select().from(healthCheckLogs).where(eq(healthCheckLogs.checkId, checkId)));
    // A reading left behind would answer the next test's slot.
    afterEach(async () => {
      await withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        tx.delete(healthEvents).where(like(healthEvents.title, "who388 reading")),
      );
    });
    const reading = async (iso: string) => {
      const [row] = await withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
        const [ev] = await tx
          .insert(healthEvents)
          .values({
            householdId: people.mom!.householdId,
            memberId: people.ally!.memberId,
            type: "vitals",
            title: "who388 reading",
            startedAt: new Date(iso),
            createdByUserId: people.mom!.userId,
          })
          .returning({ id: healthEvents.id });
        for (const metric of BP) {
          await tx.insert(healthVitalsReadings).values({ eventId: ev!.id, metric: metric as never, value: "1", unit: "x" });
        }
        return [ev!];
      });
      return row!.id;
    };

    it("skips the slot, as the person the token was sent to, with no session", async () => {
      const check = await pushCheck();
      const res = await skip(tokenFor("mom", check.id));
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      expect(res.json).toMatchObject({ ok: true, alreadyLogged: false, log: { status: "skipped", scheduledAt: at("12:00") } });
      const [row] = await rows(check.id);
      expect(row).toMatchObject({ status: "skipped", healthEventId: null, loggedByUserId: people.mom!.userId });
    });

    it("tapping twice, or on the other device too, changes nothing", async () => {
      const check = await pushCheck();
      const token = tokenFor("mom", check.id);
      expect((await skip(token)).status).toBe(201);
      const again = await skip(token);
      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({ ok: true, alreadyLogged: true, slotStatus: "skipped" });
      expect(await rows(check.id)).toHaveLength(1);
    });

    it("never overwrites a slot that was logged since the reminder", async () => {
      const check = await pushCheck();
      const eventId = await reading(at("12:03"));
      await call("mom", "POST", `/checks/${check.id}/log`, { scheduledAt: at("12:00"), eventId });
      const res = await skip(tokenFor("mom", check.id));
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ alreadyLogged: true, slotStatus: "done" });
      const [row] = await rows(check.id);
      expect(row).toMatchObject({ status: "done", healthEventId: eventId });
    });

    it("never overrides a slot a reading already answered, even without a log row", async () => {
      const check = await pushCheck();
      await reading(at("12:10"));
      const res = await skip(tokenFor("mom", check.id));
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ alreadyLogged: true, slotStatus: "done" });
      expect(await rows(check.id)).toHaveLength(0);
    });

    it("uses the device time zone to find the slot the reminder was for", async () => {
      const check = await pushCheck();
      // 08:00 Chicago (CDT, UTC-5) is 13:00Z. Read in the household's UTC it is not a slot.
      const token = tokenFor("mom", check.id, "13:00");
      expect((await skip(token)).json).toMatchObject({ error: "slot_not_found" });
      const res = await skip(token, { timeZone: "America/Chicago" });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      expect((await rows(check.id))[0]!.scheduledAt.toISOString()).toBe(at("13:00"));
    });

    it("an instant that is not a slot of the check is not found", async () => {
      const check = await pushCheck();
      const res = await skip(tokenFor("mom", check.id, "10:00"));
      expect(res.status).toBe(404);
      expect(res.json.error).toBe("slot_not_found");
      expect(await rows(check.id)).toHaveLength(0);
    });

    it("rechecks access every time: write is needed, read is not enough, and strangers see nothing", async () => {
      const check = await pushCheck();
      expect((await skip(tokenFor("reader", check.id))).status).toBe(403); // events: read only
      const stranger = await skip(tokenFor("stranger", check.id));
      expect(stranger.status).toBe(404); // cannot even see it
      expect(stranger.json.error).toBe("not_found");
      expect(await rows(check.id)).toHaveLength(0);
      const sitter = await skip(tokenFor("sitter", check.id)); // events: write on Ally
      expect(sitter.status, JSON.stringify(sitter.json)).toBe(201);
      expect((await rows(check.id))[0]!.loggedByUserId).toBe(people.sitter!.userId);
    });

    it("a token for someone in another household cannot reach this household's check", async () => {
      const check = await pushCheck();
      const forged = mintHealthCheckPushActionToken(
        { householdId: people.mom!.householdId, userId: people.outsider!.userId, checkId: check.id, scheduledAt: at("12:00") },
        secret,
      );
      expect((await skip(forged)).status).toBe(403);
      expect(await rows(check.id)).toHaveLength(0);
    });

    it("a deleted check is not found", async () => {
      const check = await pushCheck();
      await call("mom", "DELETE", `/checks/${check.id}`);
      expect((await skip(tokenFor("mom", check.id))).status).toBe(404);
    });

    it("a household without the health module is refused", async () => {
      const res = await skip(
        mintHealthCheckPushActionToken(
          { householdId: people.nohealth!.householdId, userId: people.nohealth!.userId, checkId: randomUUID(), scheduledAt: at("12:00") },
          secret,
        ),
      );
      expect(res.status).toBe(403);
      expect(res.json.error).toBe("module_disabled");
    });

    it("rejects bad requests and bad tokens", async () => {
      const check = await pushCheck();
      const good = tokenFor("mom", check.id);
      expect((await push({})).status).toBe(400);
      expect((await push({ token: good })).status).toBe(400); // no action
      expect((await push({ token: good, action: "taken" })).status).toBe(400); // a check can only be skipped
      expect((await skip("not.a-token")).status).toBe(401);
      expect((await skip(`${good.split(".")[0]}.AAAA`)).status).toBe(401); // bad signature
      expect((await skip(tokenFor("mom", check.id, "12:00", Date.now() - 5 * 60 * 60 * 1000))).status).toBe(401); // expired
      // A medication token must not work here.
      const med = mintHealthMedPushActionToken(
        { householdId: people.mom!.householdId, userId: people.mom!.userId, medicationId: randomUUID(), scheduledAt: at("12:00") },
        secret,
      );
      expect((await skip(med)).status).toBe(401);
      expect(await rows(check.id)).toHaveLength(0);
    });
  });

  describe("glance and calendar overlays for checks (WHO-392)", () => {
    // The household is on UTC. Date is frozen at noon UTC on the day the run started, so "today"
    // cannot change under a test (crossing midnight mid-run would move the dates the helpers and the
    // server compute) and 00:00 is always past while 23:59 is always ahead.
    beforeEach(() => {
      const day = new Date().toISOString().slice(0, 10);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${day}T12:00:00.000Z`));
    });
    const today = () => new Date().toISOString().slice(0, 10);
    const EARLY = () => `${today()}T00:00:00.000Z`;
    const LATE = () => `${today()}T23:59:00.000Z`;
    const BPM = ["blood_pressure_systolic", "blood_pressure_diastolic"];

    const dayCheck = (over: Record<string, unknown> = {}) =>
      makeCheck("mom", {
        name: "392 BP",
        startDate: null,
        endDate: null,
        template: { metrics: BPM },
        schedule: { times: ["00:00", "23:59"] },
        ...over,
      });
    const glance = async (as: string) => (await call(as, "GET", "/health/glance")).json as Json;
    const overlays = (as: string, from = today(), to = today()) => {
      const p = people[as]!;
      return withHouseholdContext(baseDb, p.householdId, (tx) =>
        buildCheckSlotOverlays(tx, env, { householdId: p.householdId, userId: p.userId, memberId: p.memberId, role: p.role }, from, to),
      );
    };
    const reading = async (iso: string) => {
      const [row] = await withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
        const [ev] = await tx
          .insert(healthEvents)
          .values({
            householdId: people.mom!.householdId,
            memberId: people.ally!.memberId,
            type: "vitals",
            title: "who392 reading",
            startedAt: new Date(iso),
            createdByUserId: people.mom!.userId,
          })
          .returning({ id: healthEvents.id });
        for (const metric of BPM) {
          await tx.insert(healthVitalsReadings).values({ eventId: ev!.id, metric: metric as never, value: "1", unit: "x" });
        }
        return [ev!];
      });
      return row!.id;
    };
    const mine = (list: Json[], checkId: string) => list.filter((x) => x.checkId === checkId);
    /** Deleted but still switched on: the delete route also switches it off, so only a direct write isolates the deleted rule. */
    const softDeleteStillEnabled = async (checkId: string) =>
      withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        tx.update(healthChecks).set({ deletedAt: new Date(), enabled: true }).where(eq(healthChecks.id, checkId)),
      );

    // A reading left behind would answer the next test's 00:00 slot by matching.
    afterEach(async () => {
      vi.useRealTimers();
      await withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        tx.delete(healthEvents).where(like(healthEvents.title, "who392 reading")),
      );
    });

    describe("the health glance", () => {
      it("lists today's waiting slots and counts the answered ones", async () => {
        const check = await dayCheck();
        const before = await glance("mom");
        const waiting = mine(before.pendingChecks, check.id);
        expect(waiting.map((w: Json) => w.scheduledAt)).toEqual([EARLY(), LATE()]);
        expect(waiting[0]).toMatchObject({ name: "392 BP", memberId: people.ally!.memberId, status: expect.stringMatching(/due|overdue/) });
        expect(waiting[1]).toMatchObject({ status: expect.stringMatching(/upcoming|due/), scheduledTimeLabel: expect.any(String), memberLabel: expect.anything() });

        const eventId = await reading(EARLY());
        await call("mom", "POST", `/checks/${check.id}/log`, { scheduledAt: EARLY(), eventId });
        const after = await glance("mom");
        expect(mine(after.pendingChecks, check.id).map((w: Json) => w.scheduledAt)).toEqual([LATE()]);
        // Progress is across everything the viewer can see, so compare with what it was.
        expect(after.checkProgress.done).toBe(before.checkProgress.done + 1);
        expect(after.checkProgress.total).toBe(before.checkProgress.total);
      });

      it("leaves out paused and deleted checks, and ones the viewer cannot see", async () => {
        const paused = await dayCheck({ name: "392 paused" });
        await call("mom", "PATCH", `/checks/${paused.id}`, { enabled: false });
        const gone = await dayCheck({ name: "392 gone" });
        await call("mom", "DELETE", `/checks/${gone.id}`);
        const hidden = await dayCheck({ name: "392 hidden" });
        const deletedOnly = await dayCheck({ name: "392 deleted only" });
        await softDeleteStillEnabled(deletedOnly.id);
        const g = await glance("mom");
        for (const c of [paused, gone, deletedOnly]) expect(mine(g.pendingChecks, c.id)).toHaveLength(0);
        expect(mine(g.pendingChecks, hidden.id)).toHaveLength(2);
        // A member with no access to Ally's private check sees none of it.
        const other = await glance("stranger");
        expect(mine(other.pendingChecks, hidden.id)).toHaveLength(0);
      });

      it("still returns the doses when there are no checks at all", async () => {
        const g = await glance("outsider");
        expect(g).toMatchObject({ enabled: true, pendingChecks: [], checkProgress: { done: 0, total: 0 } });
        expect(g.pendingDoses).toEqual([]);
      });
    });

    describe("calendar overlays", () => {
      it("shows a chip for each waiting slot, opening that slot, and hides answered ones", async () => {
        const check = await dayCheck();
        const chips = (await overlays("mom")).filter((o) => o.id.includes(check.id));
        expect(chips.map((c) => c.startTime)).toEqual(["00:00:00", "23:59:00"]);
        expect(chips[0]).toMatchObject({
          title: "392 BP",
          // Who it is for, or the calendar's person filter would hide every check chip.
          attendeeMemberIds: [people.ally!.memberId],
          overlayKind: "health_check",
          source: "health_check",
          startDate: today(),
          deepLink: `/health?check=${check.id}&scheduledAt=${encodeURIComponent(EARLY())}`,
        });

        const eventId = await reading(EARLY());
        await call("mom", "POST", `/checks/${check.id}/log`, { scheduledAt: EARLY(), eventId });
        const after = (await overlays("mom")).filter((o) => o.id.includes(check.id));
        expect(after.map((c) => c.startTime)).toEqual(["23:59:00"]);

        await call("mom", "POST", `/checks/${check.id}/log`, { scheduledAt: LATE(), status: "skipped" });
        expect((await overlays("mom")).filter((o) => o.id.includes(check.id))).toHaveLength(0);
      });

      it("collapses the slots a group covers into one chip for the group, and leaves the others", async () => {
        const a = await dayCheck({ name: "392 A" });
        const b = await dayCheck({ name: "392 B" });
        const group = await makeGroup("mom", { name: "392 Night", schedule: { times: ["23:59"] }, checkIds: [a.id, b.id] });
        const chips = (await overlays("mom")).filter((o) => o.id.includes(a.id) || o.id.includes(b.id) || o.id.includes(group.id));
        // 23:59 is one chip for the group; 00:00 is each check's own.
        const groupChips = chips.filter((c) => c.id.includes("checkgroup"));
        expect(groupChips).toHaveLength(1);
        expect(groupChips[0]).toMatchObject({
          title: "392 Night",
          attendeeMemberIds: [people.ally!.memberId],
          startTime: "23:59:00",
          deepLink: `/health?checkGroup=${group.id}&scheduledAt=${encodeURIComponent(LATE())}`,
        });
        expect(chips.filter((c) => c.startTime === "00:00:00").map((c) => c.title).sort()).toEqual(["392 A", "392 B"]);
      });

      it("keeps a group's chip until every member is answered", async () => {
        const a = await dayCheck({ name: "392 A2" });
        const b = await dayCheck({ name: "392 B2" });
        const group = await makeGroup("mom", { name: "392 Late", schedule: { times: ["23:59"] }, checkIds: [a.id, b.id] });
        const chipFor = async () => (await overlays("mom")).filter((o) => o.id.includes(`checkgroup:${group.id}`));
        await call("mom", "POST", `/checks/${a.id}/log`, { scheduledAt: LATE(), status: "skipped" });
        expect(await chipFor()).toHaveLength(1);
        await call("mom", "POST", `/checks/${b.id}/log`, { scheduledAt: LATE(), status: "skipped" });
        expect(await chipFor()).toHaveLength(0);
      });

      it("spans a range of days, one chip per day for a daily check", async () => {
        const check = await dayCheck({ name: "392 range", schedule: { times: ["23:59"] } });
        const start = today();
        const end = new Date(Date.parse(`${start}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
        const chips = (await overlays("mom", start, end)).filter((o) => o.id.includes(check.id));
        expect(chips).toHaveLength(3);
        expect(new Set(chips.map((c) => c.startDate)).size).toBe(3);
      });

      it("starts on the day the check was set up, so a new check does not paint earlier days as unanswered", async () => {
        const check = await dayCheck({ name: "392 new", schedule: { times: ["23:59"] } });
        const weekAgo = new Date(Date.parse(`${today()}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
        const chips = (await overlays("mom", weekAgo, today())).filter((o) => o.id.includes(check.id));
        expect(chips.map((c) => c.startDate)).toEqual([today()]);
      });

      it("shows nothing for paused or deleted checks, or to someone who cannot see them", async () => {
        const paused = await dayCheck({ name: "392 paused" });
        await call("mom", "PATCH", `/checks/${paused.id}`, { enabled: false });
        const gone = await dayCheck({ name: "392 gone" });
        await call("mom", "DELETE", `/checks/${gone.id}`);
        const hidden = await dayCheck({ name: "392 hidden" });
        const deletedOnly = await dayCheck({ name: "392 deleted only" });
        await softDeleteStillEnabled(deletedOnly.id);
        const own = await overlays("mom");
        expect(
          own.filter((o) => o.id.includes(paused.id) || o.id.includes(gone.id) || o.id.includes(deletedOnly.id)),
        ).toHaveLength(0);
        expect(own.filter((o) => o.id.includes(hidden.id)).length).toBeGreaterThan(0);
        expect((await overlays("stranger")).filter((o) => o.id.includes(hidden.id))).toHaveLength(0);
      });
    });
  });

  describe("reports for checks (WHO-393)", () => {
    // Date is frozen at noon UTC on the day the run started (the household is UTC), so 00:00, 04:00
    // and 08:00 are past, and 23:59 is ahead, whatever time the suite really runs.
    beforeEach(() => {
      const day = new Date().toISOString().slice(0, 10);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${day}T12:00:00.000Z`));
    });
    afterEach(async () => {
      vi.useRealTimers();
      await withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        tx.delete(healthEvents).where(like(healthEvents.title, "who393 reading")),
      );
    });

    const today = () => new Date().toISOString().slice(0, 10);
    const at = (hhmm: string) => `${today()}T${hhmm}:00.000Z`;
    const authOf = (key: string) => {
      const p = people[key]!;
      return { householdId: p.householdId, userId: p.userId, memberId: p.memberId, role: p.role };
    };
    const adherence = (as: string, from: string, to: string, memberId?: string) =>
      withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        buildCheckAdherenceReport(tx, env, authOf(as), from, to, { memberId }),
      );
    const bp = (as: string, from: string, to: string, memberId?: string) =>
      withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
        buildBloodPressureReport(tx, env, authOf(as), from, to, { memberId }),
      );

    async function reading(iso: string, values: Record<string, number>, memberKey = "ally") {
      const [row] = await withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
        const [ev] = await tx
          .insert(healthEvents)
          .values({
            householdId: people.mom!.householdId,
            memberId: people[memberKey]!.memberId,
            type: "vitals",
            title: "who393 reading",
            startedAt: new Date(iso),
            createdByUserId: people.mom!.userId,
          })
          .returning({ id: healthEvents.id });
        for (const [metric, value] of Object.entries(values)) {
          await tx
            .insert(healthVitalsReadings)
            .values({ eventId: ev!.id, metric: metric as never, value: String(value), unit: metric === "heart_rate" ? "bpm" : "mmHg" });
        }
        return [ev!];
      });
      return row!.id;
    }

    describe("check adherence", () => {
      const keptCheck = async (name = "393 adherence") => {
        const check = await makeCheck("mom", {
          name,
          startDate: null,
          endDate: null,
          template: { metrics: ["blood_pressure_systolic", "blood_pressure_diastolic"] },
          schedule: { times: ["00:00", "04:00", "08:00", "23:59"] },
        });
        const eventId = await reading(at("00:05"), { blood_pressure_systolic: 120, blood_pressure_diastolic: 80 });
        await call("mom", "POST", `/checks/${check.id}/log`, { scheduledAt: at("00:00"), eventId });
        await call("mom", "POST", `/checks/${check.id}/log`, { scheduledAt: at("04:00"), status: "skipped" });
        return check;
      };
      const rowFor = (report: Awaited<ReturnType<typeof adherence>>, checkId: string) =>
        report.byCheck.find((r) => r.checkId === checkId);

      it("counts what was done, skipped and missed, and leaves out the time that is still ahead", async () => {
        const check = await keptCheck();
        const report = await adherence("mom", today(), today());
        expect(rowFor(report, check.id)).toMatchObject({
          name: "393 adherence",
          memberId: people.ally!.memberId,
          memberLabel: "ally",
          due: 3,
          done: 1,
          skipped: 1,
          missed: 1,
          completionPercent: 33,
        });
        // Whatever else is in the household, the totals are the rows added up.
        const sum = (k: "due" | "done" | "skipped" | "missed") => report.byCheck.reduce((n, r) => n + r[k], 0);
        expect(report.totals).toMatchObject({ due: sum("due"), done: sum("done"), skipped: sum("skipped"), missed: sum("missed") });
        expect(report.timezone).toBe("UTC");
      });

      it("lists the skipped and missed times, oldest first", async () => {
        const check = await keptCheck("393 gaps");
        const report = await adherence("mom", today(), today());
        const gaps = report.gaps.filter((g) => g.checkName === "393 gaps");
        expect(gaps.map((g) => [g.timeLabel, g.status])).toEqual([
          ["4:00 AM", "skipped"],
          ["8:00 AM", "missed"],
        ]);
        expect(gaps[0]).toMatchObject({ date: today(), scheduledAt: at("04:00"), memberLabel: "ally" });
        expect(rowFor(report, check.id)).toBeDefined();
      });

      it("does not count days before the check was set up, however far back the range reaches", async () => {
        const check = await keptCheck("393 new");
        const weekAgo = new Date(Date.parse(`${today()}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
        const report = await adherence("mom", weekAgo, today());
        expect(rowFor(report, check.id)).toMatchObject({ due: 3, done: 1, skipped: 1, missed: 1 });
      });

      it("keeps a paused check's history, and a deleted check's", async () => {
        const paused = await keptCheck("393 paused");
        await call("mom", "PATCH", `/checks/${paused.id}`, { enabled: false });
        const gone = await keptCheck("393 gone");
        await call("mom", "DELETE", `/checks/${gone.id}`);
        const report = await adherence("mom", today(), today());
        expect(rowFor(report, paused.id)).toMatchObject({ done: 1, skipped: 1, missed: 1 });
        expect(rowFor(report, gone.id)).toMatchObject({ done: 1, skipped: 1, missed: 1 });
      });

      it("only reports checks the viewer can see, and can be narrowed to one person", async () => {
        const check = await keptCheck("393 private");
        expect(rowFor(await adherence("stranger", today(), today()), check.id)).toBeUndefined();
        expect(rowFor(await adherence("mom", today(), today(), people.ally!.memberId), check.id)).toBeDefined();
        expect((await adherence("mom", today(), today(), people.dad!.memberId)).byCheck.filter((r) => r.checkId === check.id)).toEqual([]);
      });

      it("is empty for a range entirely in the future, and refuses a bad range", async () => {
        const future = new Date(Date.parse(`${today()}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
        const report = await adherence("mom", future, future);
        expect(report).toMatchObject({ byCheck: [], gaps: [], totals: { due: 0, completionPercent: null } });
        await expect(adherence("mom", "2026-13-40", today())).rejects.toMatchObject({ code: "invalid_date" });
        await expect(adherence("mom", today(), "2020-01-01")).rejects.toMatchObject({ code: "end_before_start" });
        await expect(adherence("mom", "2024-01-01", today())).rejects.toMatchObject({ code: "range_too_large" });
        await expect(adherence("mom", today(), today(), "not-a-uuid")).rejects.toMatchObject({ code: "invalid_member" });
      });
    });

    describe("blood pressure", () => {
      const DAY = "2026-08-15";
      const on = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;
      const BPV = (sys: number, dia: number, hr?: number) => ({
        blood_pressure_systolic: sys,
        blood_pressure_diastolic: dia,
        ...(hr != null ? { heart_rate: hr } : {}),
      });
      const seedDay = async () => {
        await reading(on("08:00"), BPV(120, 80, 70));
        await reading(on("14:00"), BPV(130, 85, 74));
        await reading(on("21:00"), BPV(110, 70));
      };

      it("gathers the readings with averages, the lowest and highest, and a split by time of day", async () => {
        await seedDay();
        const report = await bp("mom", DAY, DAY);
        expect(report.people).toHaveLength(1);
        const [ally] = report.people;
        expect(ally).toMatchObject({ memberId: people.ally!.memberId, memberLabel: "ally" });
        expect(ally!.readings.map((r) => [r.timeLabel, `${r.systolic}/${r.diastolic}`, r.heartRate])).toEqual([
          ["8:00 AM", "120/80", 70],
          ["2:00 PM", "130/85", 74],
          ["9:00 PM", "110/70", null],
        ]);
        expect(ally!.summary).toMatchObject({ count: 3, avgSystolic: 120, avgDiastolic: 78, avgHeartRate: 72 });
        expect(ally!.summary.lowest).toMatchObject({ systolic: 110, diastolic: 70 });
        expect(ally!.summary.highest).toMatchObject({ systolic: 130, diastolic: 85 });
        expect(ally!.summary.byPeriod.map((p) => [p.period, p.count])).toEqual([
          ["Morning", 1],
          ["Afternoon", 1],
          ["Evening", 1],
        ]);
      });

      it("leaves out vitals that are not a full blood pressure, and anything outside the range", async () => {
        await seedDay();
        await reading(on("09:00"), { weight: 150 });
        await reading(on("10:00"), { blood_pressure_systolic: 125 });
        await reading(`2026-08-16T09:00:00.000Z`, BPV(140, 90));
        await reading(`2026-08-14T23:59:00.000Z`, BPV(100, 60));
        const report = await bp("mom", DAY, DAY);
        expect(report.people[0]!.summary.count).toBe(3);
      });

      it("includes the days at both ends of the range", async () => {
        await reading(`2026-08-15T00:00:00.000Z`, BPV(121, 81));
        await reading(`2026-08-16T23:59:00.000Z`, BPV(122, 82));
        const report = await bp("mom", "2026-08-15", "2026-08-16");
        expect(report.people[0]!.readings.map((r) => r.systolic)).toEqual([121, 122]);
      });

      it("only includes entries the viewer can see in reports, and can be narrowed to one person", async () => {
        await seedDay();
        expect((await bp("stranger", DAY, DAY)).people).toEqual([]);
        expect((await bp("mom", DAY, DAY, people.ally!.memberId)).people).toHaveLength(1);
        expect((await bp("mom", DAY, DAY, people.dad!.memberId)).people).toEqual([]);
      });

      it("is empty when nothing was logged, and refuses a bad range", async () => {
        expect((await bp("mom", "2026-01-01", "2026-01-02")).people).toEqual([]);
        await expect(bp("mom", "nope", DAY)).rejects.toBeInstanceOf(CheckReportRangeError);
        await expect(bp("mom", DAY, DAY, "not-a-uuid")).rejects.toMatchObject({ code: "invalid_member" });
      });
    });
  });
});
