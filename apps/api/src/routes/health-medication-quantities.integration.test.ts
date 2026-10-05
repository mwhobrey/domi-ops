import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthMedicationDoseQuantities,
  healthMedicationGroups,
  healthMedications,
  healthMemberAcl,
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
import { CapExceededError, assertRoomFor, lockQuota, type HealthCap } from "../lib/health-quota.js";
import { ReferenceNotFoundError, requireInHousehold } from "../lib/health-references.js";

/**
 * WHO-417: pills per dose time on medications, the same-household checks and the creation limits,
 * against a real Postgres as the app role. Auth is faked by a parent app that sets `auth` per request
 * from the `x-as` header; everything below it, including the tenant middleware, is the real code.
 * Skipped without a database.
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

maybeDescribe("medication dose quantities, references and limits (integration)", () => {
  const marker = `who417-${Date.now()}`;
  let baseDb: Database;
  let app: Hono<{ Variables: AppVariables }>;
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
          .values({ email: `who417-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
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

  const med = (over: Record<string, unknown> = {}) => ({
    memberId: people.ally!.memberId,
    name: `${marker} med`,
    scheduleKind: "scheduled",
    schedule: { times: ["08:00", "21:00"] },
    visibility: "household",
    ...over,
  });

  async function makeMed(over: Record<string, unknown> = {}, as = "mom"): Promise<Json> {
    const res = await call(as, "POST", "/health/medications", med(over));
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json.medication;
  }

  const storedQuarters = (medicationId: string) =>
    withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
      const rows = await tx
        .select({ time: healthMedicationDoseQuantities.doseTime, q: healthMedicationDoseQuantities.quantityQuarters })
        .from(healthMedicationDoseQuantities)
        .where(eq(healthMedicationDoseQuantities.medicationId, medicationId));
      return Object.fromEntries(rows.map((r) => [r.time.slice(0, 5), r.q]));
    });

  const countMeds = () =>
    withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
      const rows = await tx.select({ id: healthMedications.id }).from(healthMedications).where(like(healthMedications.name, `${marker}%`));
      return rows.length;
    });

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    const hh = await seedHousehold(`${marker}-home`, [
      { key: "mom", role: "owner" },
      { key: "ally", role: "child" },
      { key: "reader", role: "member" },
      { key: "stranger", role: "member" },
    ]);
    await seedHousehold(`${marker}-other`, [{ key: "outsider", role: "owner" }]);
    // reader may see Ally's medications but not change them.
    await withHouseholdContext(baseDb, hh, (tx) =>
      tx.insert(healthMemberAcl).values({
        householdId: hh,
        subjectMemberId: people.ally!.memberId,
        granteeMemberId: people.reader!.memberId,
        medicationsAccess: "read",
      }),
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
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("pills per dose time", () => {
    it("stores whole quarters and answers in pills", async () => {
      const m = await makeMed({ doseQuantities: { "08:00": 1.5, "21:00": 0.25 } });
      expect(m.doseQuantities).toEqual({ "08:00": 1.5, "21:00": 0.25 });
      expect(m.doseQuantityIssues).toEqual({ missing: [], orphaned: [] });
      expect(await storedQuarters(m.id)).toEqual({ "08:00": 6, "21:00": 1 });
    });

    it("leaves every existing field of the response as it was, and reports what is missing", async () => {
      const m = await makeMed();
      for (const key of ["id", "memberId", "groupIds", "name", "dosage", "instructions", "scheduleKind", "schedule", "reminderOffsets", "startDate", "endDate", "enabled", "visibility", "createdByUserId", "createdAt", "updatedAt", "sharedMemberIds", "isOwnedByMe", "canEdit", "canLog"]) {
        expect(m, key).toHaveProperty(key);
      }
      expect(m.doseQuantities).toEqual({});
      expect(m.doseQuantityIssues).toEqual({ missing: ["08:00", "21:00"], orphaned: [] });
    });

    it("normalises times, so 08:00:00 is 08:00", async () => {
      const m = await makeMed({ doseQuantities: { "08:00:00": 2 } });
      expect(m.doseQuantities).toEqual({ "08:00": 2 });
      expect(await storedQuarters(m.id)).toEqual({ "08:00": 8 });
    });

    it("refuses bad input with a clear code and writes nothing", async () => {
      const before = await countMeds();
      const bad: Array<[string, unknown, string]> = [
        ["not a quarter", { "08:00": 0.3 }, "quantity_not_quarter_step"],
        ["zero", { "08:00": 0 }, "quantity_out_of_range"],
        ["negative", { "08:00": -1 }, "quantity_out_of_range"],
        ["too many pills", { "08:00": 100.25 }, "quantity_out_of_range"],
        ["a string", { "08:00": "1.5" }, "invalid_quantity"],
        ["null", { "08:00": null }, "invalid_quantity"],
        ["a bad time", { "8:00": 1 }, "invalid_dose_time"],
        ["seconds", { "08:00:30": 1 }, "invalid_dose_time"],
        ["a time the medication does not take", { "12:00": 1 }, "quantity_time_not_scheduled"],
        ["the same time twice", { "08:00": 1, "08:00:00": 2 }, "duplicate_dose_time"],
        ["a list", [1, 2], "invalid_dose_quantities"],
        ["a number", 5, "invalid_dose_quantities"],
        ["null body value", null, "invalid_dose_quantities"],
      ];
      for (const [label, doseQuantities, code] of bad) {
        const res = await call("mom", "POST", "/health/medications", med({ doseQuantities }));
        expect(res.status, label).toBe(400);
        expect(res.json.error, label).toBe(code);
      }
      expect(await countMeds()).toBe(before);
    });

    it("only goes on a scheduled medication, but an empty set is always fine", async () => {
      const prn = await call("mom", "POST", "/health/medications", med({ scheduleKind: "prn", schedule: {}, doseQuantities: { "08:00": 1 } }));
      expect(prn.status).toBe(400);
      expect(prn.json.error).toBe("quantities_need_scheduled_medication");
      const empty = await call("mom", "POST", "/health/medications", med({ scheduleKind: "prn", schedule: {}, doseQuantities: {} }));
      expect(empty.status).toBe(201);
      expect(empty.json.medication.doseQuantities).toEqual({});
      expect(empty.json.medication.doseQuantityIssues).toEqual({ missing: [], orphaned: [] });
    });

    it("replaces the whole set on edit; {} clears; leaving it out changes nothing", async () => {
      const m = await makeMed({ doseQuantities: { "08:00": 1, "21:00": 2 } });
      const replaced = await call("mom", "PATCH", `/health/medications/${m.id}`, { doseQuantities: { "08:00": 3 } });
      expect(replaced.status, JSON.stringify(replaced.json)).toBe(200);
      expect(replaced.json.medication.doseQuantities).toEqual({ "08:00": 3 });
      expect(replaced.json.medication.doseQuantityIssues).toEqual({ missing: ["21:00"], orphaned: [] });
      expect(await storedQuarters(m.id)).toEqual({ "08:00": 12 });

      const untouched = await call("mom", "PATCH", `/health/medications/${m.id}`, { dosage: "5 mg" });
      expect(untouched.json.medication.doseQuantities).toEqual({ "08:00": 3 });

      const cleared = await call("mom", "PATCH", `/health/medications/${m.id}`, { doseQuantities: {} });
      expect(cleared.json.medication.doseQuantities).toEqual({});
      expect(await storedQuarters(m.id)).toEqual({});
    });

    it("flags what a schedule edit leaves behind or needs, instead of guessing", async () => {
      const m = await makeMed({ doseQuantities: { "08:00": 1, "21:00": 2 } });
      const moved = await call("mom", "PATCH", `/health/medications/${m.id}`, { schedule: { times: ["09:00", "21:00"] } });
      expect(moved.status).toBe(200);
      // 08:00 is no longer taken (orphaned); 09:00 is new (missing); 21:00 is untouched.
      expect(moved.json.medication.doseQuantities).toEqual({ "08:00": 1, "21:00": 2 });
      expect(moved.json.medication.doseQuantityIssues).toEqual({ missing: ["09:00"], orphaned: ["08:00"] });

      const fixed = await call("mom", "PATCH", `/health/medications/${m.id}`, { doseQuantities: { "09:00": 1, "21:00": 2 } });
      expect(fixed.json.medication.doseQuantityIssues).toEqual({ missing: [], orphaned: [] });
    });

    it("checks quantities against the schedule the same request sets", async () => {
      const m = await makeMed({ doseQuantities: { "08:00": 1 } });
      const ok = await call("mom", "PATCH", `/health/medications/${m.id}`, { schedule: { times: ["10:00"] }, doseQuantities: { "10:00": 1 } });
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
      const bad = await call("mom", "PATCH", `/health/medications/${m.id}`, { schedule: { times: ["11:00"] }, doseQuantities: { "10:00": 1 } });
      expect(bad.status).toBe(400);
      expect(bad.json.error).toBe("quantity_time_not_scheduled");
      // Nothing from the refused request was applied.
      const after = await call("mom", "GET", "/health/medications");
      expect(after.json.medications.find((x: Json) => x.id === m.id).schedule.times).toEqual(["10:00"]);
    });

    it("flags every quantity as left behind when a medication becomes as-needed", async () => {
      const m = await makeMed({ doseQuantities: { "08:00": 1, "21:00": 2 } });
      const prn = await call("mom", "PATCH", `/health/medications/${m.id}`, { scheduleKind: "prn", schedule: {} });
      expect(prn.status).toBe(200);
      expect(prn.json.medication.doseQuantityIssues).toEqual({ missing: [], orphaned: ["08:00", "21:00"] });
    });

    it("lists quantities for several medications at once", async () => {
      const a = await makeMed({ name: `${marker} list a`, doseQuantities: { "08:00": 1 } });
      const b = await makeMed({ name: `${marker} list b`, schedule: { times: ["12:00"] }, doseQuantities: { "12:00": 2.5 } });
      const list = await call("mom", "GET", "/health/medications");
      const byId = new Map<string, Json>(list.json.medications.map((x: Json) => [x.id, x]));
      expect(byId.get(a.id).doseQuantities).toEqual({ "08:00": 1 });
      expect(byId.get(b.id).doseQuantities).toEqual({ "12:00": 2.5 });
      expect(byId.get(b.id).doseQuantityIssues).toEqual({ missing: [], orphaned: [] });
    });

    it("is readable by someone with read access and cannot be changed by them", async () => {
      const m = await makeMed({ doseQuantities: { "08:00": 1.5 } });
      const seen = await call("reader", "GET", "/health/medications");
      expect(seen.json.medications.find((x: Json) => x.id === m.id).doseQuantities).toEqual({ "08:00": 1.5 });
      const blocked = await call("reader", "PATCH", `/health/medications/${m.id}`, { doseQuantities: { "08:00": 9 } });
      expect(blocked.status).toBe(403);
      expect(await storedQuarters(m.id)).toEqual({ "08:00": 6 });
      const create = await call("reader", "POST", "/health/medications", med({ doseQuantities: { "08:00": 1 } }));
      expect(create.status).toBe(403);
    });

    it("is invisible and untouchable from another household or without access", async () => {
      const m = await makeMed({ visibility: "private", doseQuantities: { "08:00": 1 } });
      const other = await call("outsider", "GET", "/health/medications");
      expect(other.json.medications.some((x: Json) => x.id === m.id)).toBe(false);
      expect((await call("outsider", "PATCH", `/health/medications/${m.id}`, { doseQuantities: { "08:00": 9 } })).status).toBe(404);
      expect((await call("stranger", "PATCH", `/health/medications/${m.id}`, { doseQuantities: { "08:00": 9 } })).status).toBe(403);
      expect(await storedQuarters(m.id)).toEqual({ "08:00": 4 });
    });
  });

  describe("same-household references", () => {
    let ids: { member: string; medication: string; group: string; pharmacy: string };
    let outsider: { member: string; medication: string; group: string; pharmacy: string };

    async function seedRefs(householdId: string, memberId: string, label: string) {
      return withHouseholdContext(baseDb, householdId, async (tx) => {
        const [m] = await tx.insert(healthMedications).values({ householdId, memberId, name: `${marker} ref ${label}` }).returning({ id: healthMedications.id });
        const [g] = await tx.insert(healthMedicationGroups).values({ householdId, memberId, name: `${marker} ref ${label}` }).returning({ id: healthMedicationGroups.id });
        const [p] = await tx.insert(healthPharmacies).values({ householdId, name: `${marker} ref ${label}` }).returning({ id: healthPharmacies.id });
        return { member: memberId, medication: m!.id, group: g!.id, pharmacy: p!.id };
      });
    }

    beforeAll(async () => {
      if (!TEST_URL) return;
      ids = await seedRefs(people.mom!.householdId, people.ally!.memberId, "mine");
      outsider = await seedRefs(people.outsider!.householdId, people.outsider!.memberId, "theirs");
    });

    const check = (refs: Parameters<typeof requireInHousehold>[2]) =>
      withHouseholdContext(baseDb, people.mom!.householdId, (tx) => requireInHousehold(tx, people.mom!.householdId, refs));
    const codeOf = async (refs: Parameters<typeof requireInHousehold>[2]) => {
      try {
        await check(refs);
        return null;
      } catch (e) {
        if (e instanceof ReferenceNotFoundError) return e.code;
        throw e;
      }
    };

    it("accepts ids that are all in the household, repeated ids, and nothing to check", async () => {
      expect(await codeOf({ members: [ids.member, ids.member], medications: [ids.medication], groups: [ids.group], pharmacies: [ids.pharmacy], caregivers: [people.mom!.memberId, people.ally!.memberId] })).toBeNull();
      expect(await codeOf({})).toBeNull();
      expect(await codeOf({ members: [], medications: undefined })).toBeNull();
    });

    it("refuses another household's ids with a code for each kind", async () => {
      expect(await codeOf({ members: [outsider.member] })).toBe("member_not_found");
      expect(await codeOf({ caregivers: [outsider.member] })).toBe("caregiver_not_found");
      expect(await codeOf({ medications: [outsider.medication] })).toBe("medication_not_found");
      expect(await codeOf({ groups: [outsider.group] })).toBe("group_not_found");
      expect(await codeOf({ pharmacies: [outsider.pharmacy] })).toBe("pharmacy_not_found");
    });

    it("refuses the whole list when even one id is not the household's", async () => {
      expect(await codeOf({ medications: [ids.medication, outsider.medication] })).toBe("medication_not_found");
      expect(await codeOf({ caregivers: [people.mom!.memberId, outsider.member] })).toBe("caregiver_not_found");
    });

    it("answers a made-up or malformed id the same way as an unknown one", async () => {
      expect(await codeOf({ pharmacies: [randomUUID()] })).toBe("pharmacy_not_found");
      for (const bad of ["not-a-uuid", "", "1", "' or 1=1 --", ids.pharmacy + "x"]) {
        expect(await codeOf({ pharmacies: [bad] }), JSON.stringify(bad)).toBe("pharmacy_not_found");
      }
    });

    it("checks the household it is told about, not just whatever row level security happens to show", async () => {
      // Inside mom's household context her medication is visible to RLS. Asking whether it belongs to
      // the OTHER household must still say no: only the explicit household filter can make it do that.
      await expect(
        withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
          requireInHousehold(tx, people.outsider!.householdId, {
            medications: [ids.medication],
            groups: [ids.group],
            pharmacies: [ids.pharmacy],
            members: [ids.member],
          }),
        ),
      ).rejects.toMatchObject({ code: "member_not_found" });
      for (const [refs, code] of [
        [{ medications: [ids.medication] }, "medication_not_found"],
        [{ groups: [ids.group] }, "group_not_found"],
        [{ pharmacies: [ids.pharmacy] }, "pharmacy_not_found"],
      ] as const) {
        await expect(
          withHouseholdContext(baseDb, people.mom!.householdId, (tx) => requireInHousehold(tx, people.outsider!.householdId, refs)),
          code,
        ).rejects.toMatchObject({ code });
      }
      // And the right household says yes.
      await expect(
        withHouseholdContext(baseDb, people.mom!.householdId, (tx) =>
          requireInHousehold(tx, people.mom!.householdId, { medications: [ids.medication], groups: [ids.group], pharmacies: [ids.pharmacy] }),
        ),
      ).resolves.toBeUndefined();
    });

    it("reports the first kind in its fixed order when several are wrong", async () => {
      expect(await codeOf({ pharmacies: [outsider.pharmacy], members: [outsider.member] })).toBe("member_not_found");
    });
  });

  describe("limits", () => {
    const LIMIT: HealthCap = { max: 3, code: "too_many_pharmacies" };

    /** What a create route does: lock, count, refuse over the limit, insert. */
    const createWithinLimit = (name: string, lock = true) =>
      withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
        if (lock) await lockQuota(tx, `${marker}:pharmacies:${people.mom!.householdId}`);
        const [{ n }] = (await tx.execute(
          sql`select count(*)::int as n from health_pharmacies where household_id = ${people.mom!.householdId} and name like ${`${marker} cap%`}`,
        )) as unknown as Array<{ n: number }>;
        assertRoomFor(n, LIMIT);
        // Widen the window between the count and the insert, so an unlocked version would race.
        await new Promise((r) => setTimeout(r, 40));
        await tx.insert(healthPharmacies).values({ householdId: people.mom!.householdId, name });
      });

    const capRows = () =>
      withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
        const rows = await tx.select({ id: healthPharmacies.id }).from(healthPharmacies).where(and(eq(healthPharmacies.householdId, people.mom!.householdId), like(healthPharmacies.name, `${marker} cap%`)));
        return rows.length;
      });

    it("lets exactly the limit through when many requests arrive at once", async () => {
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createWithinLimit(`${marker} cap ${i}`)));
      const ok = results.filter((r) => r.status === "fulfilled");
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(ok).toHaveLength(3);
      expect(refused).toHaveLength(5);
      for (const r of refused) {
        expect(r.reason).toBeInstanceOf(CapExceededError);
        expect(r.reason).toMatchObject({ code: "too_many_pharmacies", max: 3 });
      }
      expect(await capRows()).toBe(3);
    });

    it("keeps refusing once it is full, and different keys do not wait on each other", async () => {
      await expect(createWithinLimit(`${marker} cap late`)).rejects.toBeInstanceOf(CapExceededError);
      // One request takes a lock and holds it for a while; only once it definitely has it do we ask
      // for a different key and for the same key.
      let held!: () => void;
      const holding = new Promise<void>((resolve) => (held = resolve));
      const holder = withHouseholdContext(baseDb, people.mom!.householdId, async (tx) => {
        await lockQuota(tx, `${marker}:slow`);
        held();
        await new Promise((r) => setTimeout(r, 500));
      });
      await holding;

      const timeIt = async (key: string) => {
        const t0 = Date.now();
        await withHouseholdContext(baseDb, people.mom!.householdId, (tx) => lockQuota(tx, key));
        return Date.now() - t0;
      };
      const other = await timeIt(`${marker}:fast`);
      const same = await timeIt(`${marker}:slow`);
      await holder;

      expect(other).toBeLessThan(250); // a different key does not wait
      expect(same).toBeGreaterThan(150); // the same key waits for the holder to finish
    });

    it("has the limits the plan names", async () => {
      const { HEALTH_CAPS } = await import("../lib/health-quota.js");
      expect(HEALTH_CAPS.compartmentsPerPlan.max).toBe(8);
      expect(HEALTH_CAPS.pharmaciesPerHousehold).toMatchObject({ max: 100, code: "too_many_pharmacies" });
      expect(HEALTH_CAPS.sessionsPerPerson.code).toBe("too_many_sessions");
      expect(HEALTH_CAPS.occurrencesAhead.code).toBe("too_many_occurrences");
    });

    it("says no only when full: one under the limit is allowed, at the limit is not", () => {
      expect(() => assertRoomFor(2, LIMIT)).not.toThrow();
      expect(() => assertRoomFor(3, LIMIT)).toThrow(CapExceededError);
      expect(() => assertRoomFor(0, LIMIT)).not.toThrow();
      expect(() => assertRoomFor(99, LIMIT)).toThrow(CapExceededError);
    });
  });
});
