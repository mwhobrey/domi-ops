import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import {
  closeDb,
  createDb,
  createScopedDb,
  healthMedicationSupply,
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
import { healthPharmacyRoutes } from "./health-pharmacies.js";
import { HEALTH_CAPS } from "../lib/health-quota.js";

/**
 * WHO-418: the pharmacy directory against a real Postgres as the app role. Auth is faked by a parent
 * app from the `x-as` header; the tenant middleware and everything below it are the real code.
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

maybeDescribe("pharmacy directory (integration)", () => {
  const marker = `who418-${Date.now()}`;
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
          .values({ email: `who418-${randomUUID()}@test.local`, displayName: m.key, emailVerified: true })
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

  async function makePharmacy(over: Record<string, unknown> = {}, as = "mom"): Promise<Json> {
    const res = await call(as, "POST", "/", { name: `${marker} Corner Drug`, ...over });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json.pharmacy;
  }

  /** A medication for `memberKey`, assigned to the pharmacy directly (the supply API is a later issue). */
  async function assignMed(
    pharmacyId: string,
    memberKey: string,
    visibility: "household" | "private",
    createdBy: string,
    over: Record<string, unknown> = {},
  ) {
    return withHouseholdContext(baseDb, hhId, async (tx) => {
      const [m] = await tx
        .insert(healthMedications)
        .values({
          householdId: hhId,
          memberId: people[memberKey]!.memberId,
          name: `${marker} med ${randomUUID().slice(0, 6)}`,
          scheduleKind: "prn",
          scheduleJson: "{}",
          visibility,
          createdByUserId: people[createdBy]!.userId,
          ...over,
        } as typeof healthMedications.$inferInsert)
        .returning({ id: healthMedications.id });
      await tx.insert(healthMedicationSupply).values({ medicationId: m.id, pharmacyId });
      return m.id;
    });
  }

  beforeAll(async () => {
    if (!TEST_URL) return;
    baseDb = createDb(TEST_URL);
    hhId = await seedHousehold(`${marker}-home`, [
      { key: "mom", role: "owner" },
      { key: "dad", role: "member" },
      { key: "kid", role: "child" },
      { key: "sitter", role: "child" },
    ]);
    await seedHousehold(`${marker}-other`, [{ key: "outsider", role: "owner" }]);
    // sitter is a child who may manage kid's medications.
    await withHouseholdContext(baseDb, hhId, (tx) =>
      tx.insert(healthMemberAcl).values({
        householdId: hhId,
        subjectMemberId: people.kid!.memberId,
        granteeMemberId: people.sitter!.memberId,
        medicationsAccess: "write",
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
    app.route("/", healthPharmacyRoutes(scoped, env));
  }, 60_000);

  afterAll(async () => {
    if (!baseDb) return;
    await withSystemContext(baseDb, async (tx) => {
      for (const id of householdIds) await tx.delete(households).where(eq(households.id, id));
      for (const id of userIds) await tx.delete(users).where(eq(users.id, id));
    });
    await closeDb(baseDb);
  });

  describe("create, read, edit", () => {
    it("stores the text fields encrypted and answers in clear", async () => {
      const p = await makePharmacy({ address: "1 Main St", phone: "(555) 123-4567 x12", website: "walgreens.com", notes: "ask for Dana" });
      expect(p).toMatchObject({
        address: "1 Main St",
        phone: "(555) 123-4567 x12",
        phoneTel: "5551234567;ext=12",
        website: "https://walgreens.com/",
        notes: "ask for Dana",
        medicationCount: 0,
        canEdit: true,
        archivedAt: null,
      });
      const [raw] = await withHouseholdContext(baseDb, hhId, (tx) => tx.select().from(healthPharmacies).where(eq(healthPharmacies.id, p.id)));
      for (const f of [raw!.name, raw!.address, raw!.phone, raw!.website, raw!.notes]) expect(f).toMatch(/^enc:v1:/);
    });

    it("lists the directory sorted by name, archived last, and hides archived unless asked", async () => {
      const a = await makePharmacy({ name: `${marker} Zeta` });
      const b = await makePharmacy({ name: `${marker} Alpha` });
      await call("mom", "POST", `/${a.id}/archive`, {});
      const shown = (await call("dad", "GET", "/")).json.pharmacies.map((x: Json) => x.id);
      expect(shown).toContain(b.id);
      expect(shown).not.toContain(a.id);
      const ids = (await call("dad", "GET", "/?includeArchived=true")).json.pharmacies.map((x: Json) => x.id);
      expect(ids).toContain(a.id);
      expect(ids.indexOf(a.id)).toBeGreaterThan(ids.indexOf(b.id));
    });

    it("edits only the fields sent, and a blank or null clears an optional one", async () => {
      const p = await makePharmacy({ address: "2 Oak", phone: "555 123 4567", notes: "n" });
      const res = await call("dad", "PATCH", `/${p.id}`, { notes: "", phone: null });
      expect(res.status).toBe(200);
      expect(res.json.pharmacy).toMatchObject({ name: p.name, address: "2 Oak", phone: null, phoneTel: null, notes: null });
    });

    it("refuses bad input with a code and changes nothing", async () => {
      const p = await makePharmacy();
      const bad: Array<[Record<string, unknown>, string]> = [
        [{ name: "  " }, "invalid_pharmacy_name"],
        [{ name: 5 }, "invalid_pharmacy_name"],
        [{ website: "javascript:alert(1)" }, "invalid_website"],
        [{ website: "ftp://x.com" }, "invalid_website"],
        [{ phone: "call me" }, "invalid_phone"],
        [{ address: "x".repeat(501) }, "invalid_pharmacy_text"],
        [{ notes: 7 }, "invalid_pharmacy_text"],
      ];
      for (const [body, code] of bad) {
        const res = await call("mom", "PATCH", `/${p.id}`, { name: "should not land", ...body });
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.json.error).toBe(code);
      }
      expect((await call("mom", "POST", "/", { website: "x.com" })).json.error).toBe("invalid_pharmacy_name");
      const after = (await call("mom", "GET", "/")).json.pharmacies.find((x: Json) => x.id === p.id);
      expect(after.name).toBe(p.name);
    });

    it("answers 404 for an unknown or malformed id", async () => {
      expect((await call("mom", "PATCH", `/${randomUUID()}`, { name: "x" })).status).toBe(404);
      expect((await call("mom", "PATCH", "/not-a-uuid", { name: "x" })).status).toBe(404);
      expect((await call("mom", "POST", "/not-a-uuid/archive", {})).status).toBe(404);
    });
  });

  describe("who may change it", () => {
    it("lets owners, adult members, and a child holding medications write change it", async () => {
      for (const as of ["mom", "dad", "sitter"]) {
        const res = await call(as, "POST", "/", { name: `${marker} by ${as}` });
        expect(res.status, as).toBe(201);
      }
    });

    it("lets a child without a grant read but not change", async () => {
      const p = await makePharmacy();
      const list = await call("kid", "GET", "/");
      expect(list.status).toBe(200);
      expect(list.json.canEdit).toBe(false);
      expect(list.json.pharmacies.find((x: Json) => x.id === p.id).canEdit).toBe(false);
      expect((await call("kid", "POST", "/", { name: "x" })).status).toBe(403);
      expect((await call("kid", "PATCH", `/${p.id}`, { name: "x" })).status).toBe(403);
      expect((await call("kid", "POST", `/${p.id}/archive`, {})).status).toBe(403);
      expect((await call("kid", "POST", `/${p.id}/unarchive`, {})).status).toBe(403);
    });

    it("keeps one household's directory from another's", async () => {
      const p = await makePharmacy();
      expect((await call("outsider", "GET", "/")).json.pharmacies.map((x: Json) => x.id)).not.toContain(p.id);
      expect((await call("outsider", "PATCH", `/${p.id}`, { name: "hijack" })).status).toBe(404);
      expect((await call("outsider", "POST", `/${p.id}/archive`, {})).status).toBe(404);
    });

    it("refuses an unauthenticated caller", async () => {
      expect([401, 403]).toContain((await call("nobody", "GET", "/")).status);
    });
  });

  describe("medications on a pharmacy row", () => {
    it("shows only the medications the caller may already see", async () => {
      const p = await makePharmacy();
      const shared = await assignMed(p.id, "kid", "household", "mom");
      const secret = await assignMed(p.id, "mom", "private", "mom");
      const kidsPrivate = await assignMed(p.id, "kid", "private", "kid");

      const row = async (as: string) => (await call(as, "GET", "/")).json.pharmacies.find((x: Json) => x.id === p.id);

      // mom: her own private one and the shared one; not kid's private one (admins do not auto-see PHI).
      const mom = await row("mom");
      expect(mom.medications.map((m: Json) => m.id).sort()).toEqual([shared, secret].sort());
      expect(mom.medicationCount).toBe(2);
      // dad: only the household-visible one.
      const dad = await row("dad");
      expect(dad.medications.map((m: Json) => m.id)).toEqual([shared]);
      expect(dad.medicationCount).toBe(1);
      // kid sees the shared one and their own private one.
      expect((await row("kid")).medications.map((m: Json) => m.id).sort()).toEqual([shared, kidsPrivate].sort());
      // a pharmacy used only by hidden medications looks unused
      const lonely = await makePharmacy({ name: `${marker} Lonely` });
      await assignMed(lonely.id, "mom", "private", "mom");
      const seen = (await call("dad", "GET", "/")).json.pharmacies.find((x: Json) => x.id === lonely.id);
      expect(seen).toMatchObject({ medicationCount: 0, medications: [] });
    });

    it("leaves out deleted medications and reports paused ones as paused", async () => {
      const p = await makePharmacy();
      const live = await assignMed(p.id, "kid", "household", "mom");
      const paused = await assignMed(p.id, "kid", "household", "mom", { enabled: false });
      await assignMed(p.id, "kid", "household", "mom", { deletedAt: new Date() });
      const row = (await call("mom", "GET", "/")).json.pharmacies.find((x: Json) => x.id === p.id);
      expect(row.medicationCount).toBe(2);
      expect(row.medications.find((m: Json) => m.id === live).enabled).toBe(true);
      expect(row.medications.find((m: Json) => m.id === paused).enabled).toBe(false);
    });
  });

  describe("archive", () => {
    it("archives an unused pharmacy at once, is idempotent, and unarchives", async () => {
      const p = await makePharmacy();
      const first = await call("mom", "POST", `/${p.id}/archive`, {});
      expect(first.status).toBe(200);
      expect(first.json.pharmacy.archivedAt).not.toBeNull();
      const again = await call("mom", "POST", `/${p.id}/archive`, {});
      expect(again.json.pharmacy.archivedAt).toBe(first.json.pharmacy.archivedAt);
      const back = await call("mom", "POST", `/${p.id}/unarchive`, {});
      expect(back.json.pharmacy.archivedAt).toBeNull();
    });

    it("asks for confirmation when visible medications use it, and keeps their reference", async () => {
      const p = await makePharmacy();
      const medId = await assignMed(p.id, "kid", "household", "mom");
      const ask = await call("mom", "POST", `/${p.id}/archive`, {});
      expect(ask.status).toBe(409);
      expect(ask.json).toEqual({ error: "confirmation_required", medicationCount: 1 });
      const done = await call("mom", "POST", `/${p.id}/archive`, { confirm: true });
      expect(done.status).toBe(200);
      const [supply] = await withHouseholdContext(baseDb, hhId, (tx) =>
        tx.select().from(healthMedicationSupply).where(eq(healthMedicationSupply.medicationId, medId)),
      );
      expect(supply!.pharmacyId).toBe(p.id);
    });

    it("does not let the confirmation prompt reveal a hidden medication", async () => {
      const p = await makePharmacy();
      await assignMed(p.id, "mom", "private", "mom");
      expect((await call("dad", "POST", `/${p.id}/archive`, {})).status).toBe(200);
    });
  });

  describe("limits", () => {
    it("stops at the cap with 409, counting archived ones", async () => {
      await seedHousehold(`${marker}-cap`, [{ key: "capper", role: "owner" }]);
      const capHh = people.capper!.householdId;
      await withHouseholdContext(baseDb, capHh, (tx) =>
        tx.insert(healthPharmacies).values(
          Array.from({ length: HEALTH_CAPS.pharmaciesPerHousehold.max }, (_, i) => ({
            householdId: capHh,
            name: `p${i}`,
            archivedAt: i === 0 ? new Date() : null,
          })),
        ),
      );
      const res = await call("capper", "POST", "/", { name: "one too many" });
      expect(res.status).toBe(409);
      expect(res.json).toEqual({ error: "too_many_pharmacies", max: HEALTH_CAPS.pharmaciesPerHousehold.max });
    });

    it("lets concurrent creates through only up to the cap", async () => {
      await seedHousehold(`${marker}-race`, [{ key: "racer", role: "owner" }]);
      const raceHh = people.racer!.householdId;
      const max = HEALTH_CAPS.pharmaciesPerHousehold.max;
      await withHouseholdContext(baseDb, raceHh, (tx) =>
        tx.insert(healthPharmacies).values(Array.from({ length: max - 2 }, (_, i) => ({ householdId: raceHh, name: `r${i}` }))),
      );
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => call("racer", "POST", "/", { name: `race ${i}` })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    });
  });
});
