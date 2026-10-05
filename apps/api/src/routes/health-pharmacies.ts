import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthMedications, healthMedicationSupply, healthPharmacies } from "@domi-ops/db";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { decryptHealthFieldOrPassthrough, encryptHealthField, HealthEncryptionError } from "../lib/health-crypto.js";
import { healthMedicationVisibleWhere, loadHealthAclBySubjectForGrantee } from "../lib/health-access.js";
import { CapExceededError, HEALTH_CAPS, assertRoomFor, lockQuota } from "../lib/health-quota.js";
import {
  SupplyValidationError,
  normalizePhone,
  normalizeWebsite,
} from "../lib/health-supply-validation.js";

/**
 * The household's shared pharmacy directory (WHO-418).
 *
 * Who may change it: household owners and admins, any adult member (they manage their own medications,
 * which is what a pharmacy is for), and anyone holding `medications: write` on another person. A child
 * without such a grant can read the directory but not edit it. Everyone with the health module can read.
 *
 * Which medications a pharmacy row shows: only those the caller can already see through the normal
 * medication visibility and access rules, so a pharmacy never reveals a private medication. A caller who
 * can see none gets the pharmacy with `medicationCount: 0`, the same answer as a pharmacy nobody uses.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 200;
const ADDRESS_MAX = 500;
const NOTES_MAX = 2000;

type PharmacyRow = typeof healthPharmacies.$inferSelect;
type Auth = { userId: string; householdId: string; memberId: string; role: string };

type PharmacyMedication = { id: string; memberId: string; name: string; enabled: boolean };

function encryptionErrorResponse(c: { json: (body: unknown, status?: number) => Response }, e: unknown) {
  if (e instanceof HealthEncryptionError) {
    return c.json({ error: "encryption_key_required", message: e.message }, 503);
  }
  return null;
}

export async function canManagePharmacies(db: Database, auth: Auth): Promise<boolean> {
  if (auth.role === "owner" || auth.role === "admin" || auth.role === "member") return true;
  const grants = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
  for (const g of grants.values()) if (g.medications === "write") return true;
  return false;
}

function serializePharmacy(row: PharmacyRow, env: Env, medications: PharmacyMedication[], canEdit: boolean) {
  const phone = decryptHealthFieldOrPassthrough(row.phone, env);
  let phoneTel: string | null = null;
  if (phone) {
    try {
      phoneTel = normalizePhone(phone).tel;
    } catch {
      phoneTel = null;
    }
  }
  return {
    id: row.id,
    name: decryptHealthFieldOrPassthrough(row.name, env) ?? "",
    address: decryptHealthFieldOrPassthrough(row.address, env),
    phone,
    phoneTel,
    website: decryptHealthFieldOrPassthrough(row.website, env),
    notes: decryptHealthFieldOrPassthrough(row.notes, env),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    medicationCount: medications.length,
    medications,
    canEdit,
  };
}

/** Current (not deleted) medications per pharmacy that `auth` is allowed to see. */
async function loadVisibleMedications(
  db: Database,
  env: Env,
  auth: Auth,
  pharmacyIds: string[],
): Promise<Map<string, PharmacyMedication[]>> {
  const out = new Map<string, PharmacyMedication[]>();
  if (pharmacyIds.length === 0) return out;
  const rows = await db
    .select({
      id: healthMedications.id,
      memberId: healthMedications.memberId,
      name: healthMedications.name,
      enabled: healthMedications.enabled,
      pharmacyId: healthMedicationSupply.pharmacyId,
    })
    .from(healthMedicationSupply)
    .innerJoin(healthMedications, eq(healthMedications.id, healthMedicationSupply.medicationId))
    .where(
      and(
        inArray(healthMedicationSupply.pharmacyId, pharmacyIds),
        isNull(healthMedications.deletedAt),
        healthMedicationVisibleWhere(db, auth),
      ),
    );
  for (const r of rows) {
    if (!r.pharmacyId) continue;
    const list = out.get(r.pharmacyId) ?? [];
    list.push({
      id: r.id,
      memberId: r.memberId,
      name: decryptHealthFieldOrPassthrough(r.name, env) ?? "",
      enabled: r.enabled,
    });
    out.set(r.pharmacyId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

type Fields = { name?: string; address?: string | null; phone?: string | null; website?: string | null; notes?: string | null };

/** Validates every field before anything is written. `null` or "" clears an optional field. */
function parseFields(body: Record<string, unknown>, requireName: boolean): Fields {
  const out: Fields = {};
  if (body.name !== undefined || requireName) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > NAME_MAX) {
      throw new SupplyValidationError("invalid_pharmacy_name");
    }
    out.name = body.name.trim();
  }
  const text = (key: "address" | "notes", max: number) => {
    const v = body[key];
    if (v === undefined) return;
    if (v === null || (typeof v === "string" && v.trim() === "")) {
      out[key] = null;
      return;
    }
    if (typeof v !== "string" || v.trim().length > max) throw new SupplyValidationError("invalid_pharmacy_text");
    out[key] = v.trim();
  };
  text("address", ADDRESS_MAX);
  text("notes", NOTES_MAX);
  if (body.phone !== undefined) {
    out.phone = body.phone === null || (typeof body.phone === "string" && !body.phone.trim()) ? null : normalizePhone(body.phone).display;
  }
  if (body.website !== undefined) {
    out.website = body.website === null || (typeof body.website === "string" && !body.website.trim()) ? null : normalizeWebsite(body.website);
  }
  return out;
}

function encryptFields(f: Fields, env: Env) {
  const v: Partial<typeof healthPharmacies.$inferInsert> = {};
  if (f.name !== undefined) v.name = encryptHealthField(f.name, env) ?? f.name;
  if (f.address !== undefined) v.address = encryptHealthField(f.address, env);
  if (f.phone !== undefined) v.phone = encryptHealthField(f.phone, env);
  if (f.website !== undefined) v.website = encryptHealthField(f.website, env);
  if (f.notes !== undefined) v.notes = encryptHealthField(f.notes, env);
  return v;
}

export function healthPharmacyRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  const validationResponse = (c: { json: (b: unknown, s?: number) => Response }, e: unknown) => {
    if (e instanceof SupplyValidationError) return c.json({ error: e.code }, 400);
    return null;
  };

  async function loadOne(auth: Auth, id: string): Promise<PharmacyRow | null> {
    if (!UUID.test(id)) return null;
    const [row] = await db
      .select()
      .from(healthPharmacies)
      .where(and(eq(healthPharmacies.id, id), eq(healthPharmacies.householdId, auth.householdId)))
      .limit(1);
    return row ?? null;
  }

  async function respondOne(c: { json: (b: unknown, s?: number) => Response }, auth: Auth, row: PharmacyRow, status = 200) {
    const meds = await loadVisibleMedications(db, env, auth, [row.id]);
    const canEdit = await canManagePharmacies(db, auth);
    return c.json({ pharmacy: serializePharmacy(row, env, meds.get(row.id) ?? [], canEdit) }, status as 200);
  }

  // Archived pharmacies are left out unless ?includeArchived=true (pickers never pass it).
  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const includeArchived = c.req.query("includeArchived") === "true";
    try {
      const rows = await db
        .select()
        .from(healthPharmacies)
        .where(
          includeArchived
            ? eq(healthPharmacies.householdId, auth.householdId)
            : and(eq(healthPharmacies.householdId, auth.householdId), isNull(healthPharmacies.archivedAt)),
        );
      const meds = await loadVisibleMedications(db, env, auth, rows.map((r) => r.id));
      const canEdit = await canManagePharmacies(db, auth);
      const pharmacies = rows
        .map((r) => serializePharmacy(r, env, meds.get(r.id) ?? [], canEdit))
        .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || a.name.localeCompare(b.name));
      return c.json({ pharmacies, canEdit });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);
    if (!(await canManagePharmacies(db, auth))) return c.json({ error: "forbidden" }, 403);

    let fields: Fields;
    try {
      fields = parseFields(body, true);
    } catch (e) {
      const resp = validationResponse(c, e);
      if (resp) return resp;
      throw e;
    }

    try {
      // Archived pharmacies count toward the cap: they still cost a row.
      await lockQuota(db, `pharmacies:${auth.householdId}`);
      const [{ n }] = await db
        .select({ n: count() })
        .from(healthPharmacies)
        .where(eq(healthPharmacies.householdId, auth.householdId));
      assertRoomFor(n, HEALTH_CAPS.pharmaciesPerHousehold);

      const [row] = await db
        .insert(healthPharmacies)
        .values({ householdId: auth.householdId, createdByUserId: auth.userId, ...encryptFields(fields, env) } as typeof healthPharmacies.$inferInsert)
        .returning();
      return respondOne(c, auth, row, 201);
    } catch (e) {
      if (e instanceof CapExceededError) return c.json({ error: e.code, max: e.max }, 409);
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);
    if (!(await canManagePharmacies(db, auth))) return c.json({ error: "forbidden" }, 403);
    const existing = await loadOne(auth, c.req.param("id"));
    if (!existing) return c.json({ error: "pharmacy_not_found" }, 404);

    let fields: Fields;
    try {
      fields = parseFields(body, false);
    } catch (e) {
      const resp = validationResponse(c, e);
      if (resp) return resp;
      throw e;
    }

    try {
      const [row] = await db
        .update(healthPharmacies)
        .set({ ...encryptFields(fields, env), updatedAt: new Date() })
        .where(eq(healthPharmacies.id, existing.id))
        .returning();
      return respondOne(c, auth, row);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  // Archiving keeps every reference. When medications the caller can see still use the pharmacy,
  // the client must resend with { confirm: true }. Hidden medications are deliberately not counted,
  // so this answer cannot reveal a private one.
  app.post("/:id/archive", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ confirm?: boolean }>().catch(() => ({}) as { confirm?: boolean });
    if (!(await canManagePharmacies(db, auth))) return c.json({ error: "forbidden" }, 403);
    const existing = await loadOne(auth, c.req.param("id"));
    if (!existing) return c.json({ error: "pharmacy_not_found" }, 404);

    try {
      if (existing.archivedAt === null) {
        const meds = await loadVisibleMedications(db, env, auth, [existing.id]);
        const current = meds.get(existing.id) ?? [];
        if (current.length > 0 && body.confirm !== true) {
          return c.json({ error: "confirmation_required", medicationCount: current.length }, 409);
        }
        const [row] = await db
          .update(healthPharmacies)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(healthPharmacies.id, existing.id))
          .returning();
        return respondOne(c, auth, row);
      }
      return respondOne(c, auth, existing);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/:id/unarchive", async (c) => {
    const auth = c.get("auth")!;
    if (!(await canManagePharmacies(db, auth))) return c.json({ error: "forbidden" }, 403);
    const existing = await loadOne(auth, c.req.param("id"));
    if (!existing) return c.json({ error: "pharmacy_not_found" }, 404);
    try {
      if (existing.archivedAt === null) return respondOne(c, auth, existing);
      const [row] = await db
        .update(healthPharmacies)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(healthPharmacies.id, existing.id))
        .returning();
      return respondOne(c, auth, row);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  return app;
}
