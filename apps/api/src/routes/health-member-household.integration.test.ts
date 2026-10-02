import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthEvents,
  healthMedicationGroups,
  healthMedications,
  healthMyallyfileLinks,
  householdMembers,
  households,
  users,
  withSystemContext,
  withWorkerScanContext,
  type Database,
} from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { createTenantMiddleware } from "../middleware/tenant.js";
import { healthMedicationGroupRoutes } from "./health-medication-groups.js";
import { healthMyallyfileRoutes } from "./health-myallyfile.js";
import { householdHealthRoutes } from "./household-health.js";

/**
 * WHO-402: every health write that takes a member id from the request must reject a member of
 * another household. Household admins pass `hasHealthSegmentAccess` for any id, RLS only checks a
 * row's own household_id and the FK only checks the member exists, so before the fix an owner of
 * household A could create or move health records onto household B's members.
 *
 * Auth is faked by a parent app (`x-as` header); the tenant middleware and handlers are real, so
 * this runs in household-scoped RLS transactions. Needs migrations applied; skipped without a DB.
 */
const TEST_URL = process.env.HOSTED_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const env = {
  MODULES_ENABLED: ["core", "health"],
  DEPLOYMENT_MODE: "single",
  AUTH_REQUIRED: true,
  ENCRYPTION_KEY: "test-health-encryption-key-32chars!!",
  // On, but pointing nowhere: a link attempt that passes validation fails at the network, which
  // is how this test tells "rejected" from "got through".
  MYALLYFILE_API_BASE: "http://127.0.0.1:9",
} as unknown as Env;

type Role = "owner" | "admin" | "member" | "child";
type Person = { userId: string; memberId: string; householdId: string; role: Role };
// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted field by field
type Json = any;

maybeDescribe("health writes reject members of another household (integration)", () => {
  let baseDb: Database;
  let app: Hono<{ Variables: AppVariables }>;
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const people: Record<string, Person> = {};

  async function seedHousehold(name: string, members: { key: string; role: Role }[]) {
    await withSystemContext(baseDb, async (tx) => {
      const [hh] = await tx
        .insert(households)
        .values({ name, timezone: "UTC", modulesEnabled: JSON.stringify(["core", "health"]) })
        .returning({ id: households.id });
      householdIds.push(hh.id);
      for (const m of members) {
        const [u] = await tx
          .insert(users)
          .values({ email: `who402-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
          .returning({ id: users.id });
        userIds.push(u.id);
        const [row] = await tx
          .insert(householdMembers)
          .values({ householdId: hh.id, userId: u.id, role: m.role, name: m.key })
          .returning({ id: householdMembers.id });
        people[m.key] = { userId: u.id, memberId: row.id, householdId: hh.id, role: m.role };
      }
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

  /** Rows that point at household B's member: there must never be any, whatever A tried. */
  const rowsOnForeignMember = () =>
    withWorkerScanContext(baseDb, async (tx) => {
      const memberId = people.kidB!.memberId;
      return {
        events: (await tx.select({ id: healthEvents.id }).from(healthEvents).where(eq(healthEvents.memberId, memberId))).length,
        medications: (await tx.select({ id: healthMedications.id }).from(healthMedications).where(eq(healthMedications.memberId, memberId))).length,
        groups: (await tx.select({ id: healthMedicationGroups.id }).from(healthMedicationGroups).where(eq(healthMedicationGroups.memberId, memberId))).length,
        links: (await tx.select({ id: healthMyallyfileLinks.id }).from(healthMyallyfileLinks).where(eq(healthMyallyfileLinks.memberId, memberId))).length,
      };
    });

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    await seedHousehold("who402-a", [
      { key: "ownerA", role: "owner" },
      { key: "adminA", role: "admin" },
      { key: "kidA", role: "child" },
      { key: "memberA", role: "member" },
    ]);
    await seedHousehold("who402-b", [
      { key: "ownerB", role: "owner" },
      { key: "kidB", role: "child" },
    ]);

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
    app.route("/health/medication-groups", healthMedicationGroupRoutes(scoped, env));
    app.route("/health/myallyfile", healthMyallyfileRoutes(scoped, env));
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

  const eventBody = (memberId: string) => ({ memberId, title: "Headache", type: "symptom" });
  const medBody = (memberId: string) => ({ memberId, name: "Vitamin D", schedule: { times: ["08:00"] } });
  const groupBody = (memberId: string) => ({ memberId, name: "Morning meds", schedule: { times: ["08:00"] } });
  const linkBody = (memberId: string) => ({ memberId, code: "ABCD-EFGH" });

  type Attempt = { name: string; run: (as: string, memberId: string) => Promise<{ status: number; json: Json }> };
  const creates: Attempt[] = [
    { name: "POST /events", run: (as, m) => call(as, "POST", "/health/events", eventBody(m)) },
    { name: "POST /medications", run: (as, m) => call(as, "POST", "/health/medications", medBody(m)) },
    { name: "POST /medication-groups", run: (as, m) => call(as, "POST", "/health/medication-groups", groupBody(m)) },
    { name: "POST /myallyfile/links", run: (as, m) => call(as, "POST", "/health/myallyfile/links", linkBody(m)) },
  ];

  describe("creating", () => {
    for (const attempt of creates) {
      it(`${attempt.name}: an owner or admin cannot target another household's member`, async () => {
        for (const as of ["ownerA", "adminA"]) {
          const res = await attempt.run(as, people.kidB!.memberId);
          expect({ as, status: res.status, error: res.json?.error }).toEqual({
            as,
            status: 404,
            error: "member_not_found",
          });
        }
      });

      it(`${attempt.name}: a plain member gets the same answer, not a revealing 403`, async () => {
        const res = await attempt.run("memberA", people.kidB!.memberId);
        expect({ status: res.status, error: res.json?.error }).toEqual({ status: 404, error: "member_not_found" });
      });

      it(`${attempt.name}: unknown and malformed member ids are 404, not a 500`, async () => {
        for (const bogus of [randomUUID(), "not-a-uuid", "1"]) {
          const res = await attempt.run("ownerA", bogus);
          expect({ bogus, status: res.status, error: res.json?.error }).toEqual({
            bogus,
            status: 404,
            error: "member_not_found",
          });
        }
      });
    }

    it("left nothing behind on the other household's member", async () => {
      expect(await rowsOnForeignMember()).toEqual({ events: 0, medications: 0, groups: 0, links: 0 });
    });

    it("still works for members of the caller's own household", async () => {
      expect((await call("ownerA", "POST", "/health/events", eventBody(people.kidA!.memberId))).status).toBe(201);
      expect((await call("adminA", "POST", "/health/medications", medBody(people.kidA!.memberId))).status).toBe(201);
      expect((await call("ownerA", "POST", "/health/medication-groups", groupBody(people.kidA!.memberId))).status).toBe(201);
      // The link gets past validation and only then fails, because MyAllyFile is unreachable here.
      const link = await call("ownerA", "POST", "/health/myallyfile/links", linkBody(people.kidA!.memberId));
      expect(link.status).not.toBe(404);
      expect(link.status).not.toBe(403);
      expect(link.json.error).not.toBe("member_not_found");
    });

    it("still enforces the ACL for a member of the caller's own household", async () => {
      expect((await call("memberA", "POST", "/health/events", eventBody(people.kidA!.memberId))).status).toBe(403);
      expect((await call("memberA", "POST", "/health/medications", medBody(people.kidA!.memberId))).status).toBe(403);
      // A person can always log their own health.
      expect((await call("memberA", "POST", "/health/events", eventBody(people.memberA!.memberId))).status).toBe(201);
    });
  });

  describe("moving an existing record to another member", () => {
    it("PATCH /events/:id rejects another household's member and leaves the event alone", async () => {
      const created = await call("ownerA", "POST", "/health/events", eventBody(people.kidA!.memberId));
      const id = created.json.event.id;
      for (const as of ["ownerA", "adminA"]) {
        const res = await call(as, "PATCH", `/health/events/${id}`, { memberId: people.kidB!.memberId });
        // adminA did not create it and is not its subject, so for them it may not even be visible;
        // either way it must not move.
        expect([404, 403]).toContain(res.status);
        if (as === "ownerA") expect(res.json.error).toBe("member_not_found");
      }
      const row = await withWorkerScanContext(baseDb, async (tx) => {
        const [r] = await tx.select().from(healthEvents).where(eq(healthEvents.id, id));
        return r;
      });
      expect(row!.memberId).toBe(people.kidA!.memberId);
    });

    it("PATCH /medications/:id rejects another household's member and leaves the medication alone", async () => {
      const created = await call("ownerA", "POST", "/health/medications", medBody(people.kidA!.memberId));
      const id = created.json.medication.id;
      const res = await call("ownerA", "PATCH", `/health/medications/${id}`, { memberId: people.kidB!.memberId });
      expect({ status: res.status, error: res.json.error }).toEqual({ status: 404, error: "member_not_found" });
      const row = await withWorkerScanContext(baseDb, async (tx) => {
        const [r] = await tx.select().from(healthMedications).where(eq(healthMedications.id, id));
        return r;
      });
      expect(row!.memberId).toBe(people.kidA!.memberId);
    });

    it("still allows moving to another member of the same household", async () => {
      const created = await call("ownerA", "POST", "/health/medications", medBody(people.kidA!.memberId));
      const moved = await call("ownerA", "PATCH", `/health/medications/${created.json.medication.id}`, {
        memberId: people.memberA!.memberId,
      });
      expect(moved.status).toBe(200);
      expect(moved.json.medication.memberId).toBe(people.memberA!.memberId);

      const event = await call("ownerA", "POST", "/health/events", eventBody(people.kidA!.memberId));
      const movedEvent = await call("ownerA", "PATCH", `/health/events/${event.json.event.id}`, {
        memberId: people.memberA!.memberId,
      });
      expect(movedEvent.status).toBe(200);
    });
  });
});
