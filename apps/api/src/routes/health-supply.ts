import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { MAX_LEAD_DAYS, MAX_SUPPLY_DAYS, computeSupply } from "@domi-ops/calendar-sync";
import type { Database } from "@domi-ops/db";
import {
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
  healthPharmacies,
  healthSupplySettings,
  householdMembers,
} from "@domi-ops/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { HealthEncryptionError } from "../lib/health-crypto.js";
import { hasHealthSegmentAccess, healthMedicationVisibleWhere } from "../lib/health-access.js";
import { householdTodayIsoDate } from "../lib/household-time.js";
import { loadOrganizerRanges, loadSupplyViews, type SupplyView } from "../lib/health-supply.js";

/**
 * Medication supply (WHO-419): the estimate of when a medication runs out, which pharmacy fills it,
 * and how many days ahead to ask for a refill.
 *
 *   PUT /medications/:id/supply            set or change any of it (one request, one transaction)
 *   GET /supply-settings/:memberId         a person's default refill lead time
 *   PUT /supply-settings/:memberId
 *
 * The estimate is what a person tells us: days of pills kept OUTSIDE the organizers, to which the
 * server adds what the organizers still hold. Dose logs never change it. Permissions follow the
 * medication: `medications` read to see it, write to change it.
 */

type Auth = { userId: string; householdId: string; memberId: string; role: string };
type Ctx = { json: (body: unknown, status?: number) => Response };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_MAX = 100;

const isWholeNumber = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

class BadRequest extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

type SupplyBody = {
  outsideDays?: number;
  confirmedTotalDays?: number;
  confirm?: boolean;
  leadDays?: number | null;
  pharmacyId?: string | null;
  version?: number;
  idempotencyKey?: string;
  dryRun?: boolean;
};

/** Checks the whole request before anything is read or written. */
function parseBody(raw: unknown): SupplyBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequest("invalid_body");
  const b = raw as Record<string, unknown>;
  const out: SupplyBody = {};
  if (b.outsideDays !== undefined) {
    if (!isWholeNumber(b.outsideDays, MAX_SUPPLY_DAYS)) throw new BadRequest("invalid_outside_days");
    out.outsideDays = b.outsideDays;
  }
  if (b.confirmedTotalDays !== undefined) {
    if (!isWholeNumber(b.confirmedTotalDays, MAX_SUPPLY_DAYS)) throw new BadRequest("invalid_confirmed_total");
    out.confirmedTotalDays = b.confirmedTotalDays;
  }
  if (b.confirm !== undefined) {
    if (typeof b.confirm !== "boolean") throw new BadRequest("invalid_body");
    out.confirm = b.confirm;
  }
  if (b.leadDays !== undefined) {
    if (b.leadDays !== null && !isWholeNumber(b.leadDays, MAX_LEAD_DAYS)) throw new BadRequest("invalid_lead_days");
    out.leadDays = b.leadDays as number | null;
  }
  if (b.pharmacyId !== undefined) {
    if (b.pharmacyId !== null && (typeof b.pharmacyId !== "string" || !UUID.test(b.pharmacyId))) {
      throw new BadRequest("pharmacy_not_found");
    }
    out.pharmacyId = b.pharmacyId as string | null;
  }
  if (b.version !== undefined) {
    if (typeof b.version !== "number" || !Number.isInteger(b.version) || b.version < 1) throw new BadRequest("invalid_version");
    out.version = b.version;
  }
  if (b.idempotencyKey !== undefined) {
    if (typeof b.idempotencyKey !== "string" || !b.idempotencyKey.trim() || b.idempotencyKey.length > KEY_MAX) {
      throw new BadRequest("invalid_idempotency_key");
    }
    out.idempotencyKey = b.idempotencyKey;
  }
  if (b.dryRun !== undefined) {
    if (typeof b.dryRun !== "boolean") throw new BadRequest("invalid_body");
    out.dryRun = b.dryRun;
  }

  if (out.confirm && (out.outsideDays !== undefined || out.confirmedTotalDays !== undefined)) throw new BadRequest("confirm_with_estimate");
  if (out.confirmedTotalDays !== undefined && out.outsideDays === undefined) throw new BadRequest("confirmed_total_needs_outside_days");
  const changesSomething =
    out.outsideDays !== undefined || out.confirm === true || out.leadDays !== undefined || out.pharmacyId !== undefined;
  if (!changesSomething) throw new BadRequest("nothing_to_change");
  if (out.dryRun && out.outsideDays === undefined) throw new BadRequest("dry_run_needs_outside_days");
  return out;
}

export function healthSupplyRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  const encryptionError = (c: Ctx, e: unknown) =>
    e instanceof HealthEncryptionError ? c.json({ error: "encryption_key_required", message: e.message }, 503) : null;

  async function loadMedication(auth: Auth, id: string) {
    if (!UUID.test(id)) return null;
    const [row] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, id), isNull(healthMedications.deletedAt), healthMedicationVisibleWhere(db, auth)))
      .limit(1);
    return row ?? null;
  }

  async function viewOf(auth: Auth, med: typeof healthMedications.$inferSelect): Promise<SupplyView | undefined> {
    return (await loadSupplyViews(db, env, auth.householdId, [med])).get(med.id);
  }

  app.put("/medications/:id/supply", async (c) => {
    const auth = c.get("auth")!;
    let body: SupplyBody;
    try {
      body = parseBody(await c.req.json().catch(() => null));
    } catch (e) {
      if (e instanceof BadRequest) return c.json({ error: e.code }, e.code === "pharmacy_not_found" ? 404 : 400);
      throw e;
    }

    const med = await loadMedication(auth, c.req.param("id"));
    if (!med) return c.json({ error: "medication_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      const [existing] = await db
        .select()
        .from(healthMedicationSupply)
        .where(eq(healthMedicationSupply.medicationId, med.id))
        .limit(1);

      // A repeat of the latest change answers with what it did, rather than conflicting with itself.
      if (body.idempotencyKey && existing?.lastWriteKey === body.idempotencyKey && !body.dryRun) {
        return c.json({ ...(await responseFor(auth, med)), replayed: true });
      }

      let pharmacyChange: string | null | undefined;
      if (body.pharmacyId !== undefined) {
        if (body.pharmacyId !== null && body.pharmacyId !== existing?.pharmacyId) {
          const [ph] = await db
            .select({ id: healthPharmacies.id, archivedAt: healthPharmacies.archivedAt })
            .from(healthPharmacies)
            .where(and(eq(healthPharmacies.id, body.pharmacyId), eq(healthPharmacies.householdId, auth.householdId)))
            .limit(1);
          if (!ph) return c.json({ error: "pharmacy_not_found" }, 404);
          if (ph.archivedAt !== null) return c.json({ error: "pharmacy_archived" }, 400);
        }
        pharmacyChange = body.pharmacyId;
      }

      const today = await householdTodayIsoDate(db, auth.householdId);

      // What the new estimate would be, if this request makes one.
      let estimate:
        | { runsOutOn: string; outsideDays: number; organizerDays: number; totalDays: number; confirmed: boolean; source: "manual" | "confirm" }
        | null = null;
      if (body.outsideDays !== undefined) {
        const ranges = await loadOrganizerRanges(db, med.id);
        let result;
        try {
          result = computeSupply({ today, ranges, outsideDays: body.outsideDays, confirmedTotalDays: body.confirmedTotalDays });
        } catch (e) {
          if (e instanceof RangeError) return c.json({ error: "supply_too_large" }, 400);
          throw e;
        }
        if (result.needsConfirmation) {
          const info = { organizerDays: result.organizerDays, organizerEndsOn: result.organizerEndsOn };
          if (body.dryRun) return c.json({ dryRun: true, needsConfirmation: true, ...info });
          return c.json({ error: "confirmation_required", ...info }, 409);
        }
        estimate = {
          runsOutOn: result.runsOutOn,
          outsideDays: result.outsideDays,
          organizerDays: result.organizerDays,
          totalDays: result.totalDays,
          confirmed: result.confirmed,
          source: "manual",
        };
        if (body.dryRun) {
          return c.json({ dryRun: true, needsConfirmation: false, ...estimate, estimatedOn: today });
        }
      } else if (body.confirm) {
        if (!existing || existing.runsOutOn === null) return c.json({ error: "no_estimate_to_confirm" }, 400);
        estimate = {
          runsOutOn: existing.runsOutOn,
          outsideDays: existing.outsideDays ?? 0,
          organizerDays: existing.organizerDaysCounted ?? 0,
          totalDays: (existing.outsideDays ?? 0) + (existing.organizerDaysCounted ?? 0),
          confirmed: true,
          source: "confirm",
        };
      }

      // Optimistic concurrency: the caller must have seen the version it is changing.
      if (existing) {
        if (body.version !== existing.version) {
          return c.json({ error: "version_conflict", ...(await responseFor(auth, med)) }, 409);
        }
      } else if (body.version !== undefined) {
        return c.json({ error: "version_conflict" }, 409);
      }

      const now = new Date();
      let saved: typeof healthMedicationSupply.$inferSelect | undefined;
      if (!existing) {
        [saved] = await db
          .insert(healthMedicationSupply)
          .values({
            medicationId: med.id,
            pharmacyId: pharmacyChange ?? null,
            leadDays: body.leadDays ?? null,
            ...(estimate
              ? {
                  runsOutOn: estimate.runsOutOn,
                  estimatedOn: today,
                  outsideDays: estimate.outsideDays,
                  organizerDaysCounted: estimate.organizerDays,
                  revision: 1,
                }
              : {}),
            lastWriteKey: body.idempotencyKey ?? null,
          })
          .onConflictDoNothing()
          .returning();
      } else {
        // The version in the WHERE is what makes two concurrent edits safe: the loser re-checks it
        // after the winner commits and matches no row.
        [saved] = await db
          .update(healthMedicationSupply)
          .set({
            ...(pharmacyChange !== undefined ? { pharmacyId: pharmacyChange } : {}),
            ...(body.leadDays !== undefined ? { leadDays: body.leadDays } : {}),
            ...(estimate
              ? {
                  runsOutOn: estimate.runsOutOn,
                  estimatedOn: today,
                  outsideDays: estimate.outsideDays,
                  organizerDaysCounted: estimate.organizerDays,
                  revision: sql`${healthMedicationSupply.revision} + 1`,
                }
              : {}),
            version: sql`${healthMedicationSupply.version} + 1`,
            lastWriteKey: body.idempotencyKey ?? null,
            updatedAt: now,
          })
          .where(and(eq(healthMedicationSupply.medicationId, med.id), eq(healthMedicationSupply.version, existing.version)))
          .returning();
      }
      if (!saved) return c.json({ error: "version_conflict", ...(await responseFor(auth, med)) }, 409);

      if (estimate) {
        await db.insert(healthMedicationSupplyRevisions).values({
          medicationId: med.id,
          revision: saved.revision,
          source: estimate.source,
          runsOutOn: estimate.runsOutOn,
          estimatedOn: today,
          outsideDays: estimate.outsideDays,
          organizerDaysCounted: estimate.organizerDays,
          createdByUserId: auth.userId,
        });
      }
      return c.json(await responseFor(auth, med));
    } catch (e) {
      const resp = encryptionError(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  async function responseFor(auth: Auth, med: typeof healthMedications.$inferSelect) {
    const view = await viewOf(auth, med);
    return { supply: view?.supply ?? null, pharmacy: view?.pharmacy ?? null };
  }

  async function settingsSubject(c: Ctx, auth: Auth, memberId: string, level: "read" | "write") {
    if (!UUID.test(memberId)) return c.json({ error: "member_not_found" }, 404);
    const [member] = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(and(eq(householdMembers.id, memberId), eq(householdMembers.householdId, auth.householdId)))
      .limit(1);
    if (!member) return c.json({ error: "member_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, memberId, "medications", level))) return c.json({ error: "forbidden" }, 403);
    return null;
  }

  const DEFAULT_SETTING = 7;

  app.get("/supply-settings/:memberId", async (c) => {
    const auth = c.get("auth")!;
    const memberId = c.req.param("memberId");
    const refused = await settingsSubject(c, auth, memberId, "read");
    if (refused) return refused;
    const [row] = await db.select().from(healthSupplySettings).where(eq(healthSupplySettings.memberId, memberId)).limit(1);
    return c.json({ defaultLeadDays: row?.defaultLeadDays ?? DEFAULT_SETTING });
  });

  app.put("/supply-settings/:memberId", async (c) => {
    const auth = c.get("auth")!;
    const memberId = c.req.param("memberId");
    const body = await c.req.json<{ defaultLeadDays?: unknown }>().catch(() => null);
    if (!body || !isWholeNumber(body.defaultLeadDays, MAX_LEAD_DAYS)) return c.json({ error: "invalid_lead_days" }, 400);
    const refused = await settingsSubject(c, auth, memberId, "write");
    if (refused) return refused;
    const [row] = await db
      .insert(healthSupplySettings)
      .values({ memberId, householdId: auth.householdId, defaultLeadDays: body.defaultLeadDays })
      .onConflictDoUpdate({
        target: healthSupplySettings.memberId,
        set: { defaultLeadDays: body.defaultLeadDays, updatedAt: new Date() },
      })
      .returning();
    return c.json({ defaultLeadDays: row.defaultLeadDays });
  });

  return app;
}
