import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
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
import { healthCheckGroupRoutes } from "./health-check-groups.js";
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
});
