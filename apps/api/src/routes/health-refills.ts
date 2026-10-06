import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { MAX_SUPPLY_DAYS, daysBetween } from "@domi-ops/calendar-sync";
import type { Database } from "@domi-ops/db";
import {
  healthMedicationRefillEvents,
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
} from "@domi-ops/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { decryptHealthFieldOrPassthrough, HealthEncryptionError } from "../lib/health-crypto.js";
import {
  canAccessHealthSegment,
  hasHealthSegmentAccess,
  healthMedicationVisibleWhere,
  loadHealthAclBySubjectForGrantee,
  managementGrantsForSubject,
} from "../lib/health-access.js";
import { householdTodayIsoDate } from "../lib/household-time.js";
import { computeEstimate, loadSupplyViews, type PharmacySummary, type SupplySummary } from "../lib/health-supply.js";

/**
 * The refill workflow (WHO-420): Needs refill -> Requested -> Received.
 *
 *   GET  /refills                              the work, grouped by pharmacy
 *   POST /medications/:id/supply/request       "I contacted the pharmacy"
 *   POST /medications/:id/supply/receive       "It arrived": replaces the estimate, clears the request
 *   DELETE /medications/:id/supply/request     "I asked by mistake": drops an open request
 *
 * The status itself is never stored; it is derived from the estimate, the lead time and whether a
 * request is open (see refillStatus). A request stays until it is received. Permissions follow the
 * medication: `medications` read to see it, write to act on it.
 */

type Auth = { userId: string; householdId: string; memberId: string; role: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_MAX = 100;

const isWholeNumber = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

type ReceiveBody = { outsideDays: number; confirmedTotalDays?: number; version?: number; idempotencyKey?: string; dryRun?: boolean };

/** Returns the cleaned request or the code to answer 400 with. */
function parseReceive(raw: unknown): ReceiveBody | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "invalid_body";
  const b = raw as Record<string, unknown>;
  if (!isWholeNumber(b.outsideDays, MAX_SUPPLY_DAYS)) return "invalid_outside_days";
  const out: ReceiveBody = { outsideDays: b.outsideDays };
  if (b.confirmedTotalDays !== undefined) {
    if (!isWholeNumber(b.confirmedTotalDays, MAX_SUPPLY_DAYS)) return "invalid_confirmed_total";
    out.confirmedTotalDays = b.confirmedTotalDays;
  }
  if (b.version !== undefined) {
    if (typeof b.version !== "number" || !Number.isInteger(b.version) || b.version < 1) return "invalid_version";
    out.version = b.version;
  }
  if (b.idempotencyKey !== undefined) {
    if (typeof b.idempotencyKey !== "string" || !b.idempotencyKey.trim() || b.idempotencyKey.length > KEY_MAX) return "invalid_idempotency_key";
    out.idempotencyKey = b.idempotencyKey;
  }
  if (b.dryRun !== undefined) {
    if (typeof b.dryRun !== "boolean") return "invalid_body";
    out.dryRun = b.dryRun;
  }
  return out;
}

const NO_PHARMACY = "none";

export function healthRefillRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  const encryptionError = (c: { json: (b: unknown, s?: number) => Response }, e: unknown) =>
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

  async function stateOf(auth: Auth, med: typeof healthMedications.$inferSelect) {
    const view = (await loadSupplyViews(db, env, auth.householdId, [med])).get(med.id);
    return { supply: view?.supply ?? null, pharmacy: view?.pharmacy ?? null };
  }

  // The work, grouped by pharmacy. By default only what needs attention (Needs refill and Requested);
  // ?all=true lists every active medication that has any supply information. ?memberId narrows to one person.
  app.get("/refills", async (c) => {
    const auth = c.get("auth")!;
    const all = c.req.query("all") === "true";
    const memberId = c.req.query("memberId");
    if (memberId !== undefined && !UUID.test(memberId)) return c.json({ groups: [] });
    try {
      const meds = await db
        .select()
        .from(healthMedications)
        .where(
          and(
            isNull(healthMedications.deletedAt),
            eq(healthMedications.enabled, true),
            healthMedicationVisibleWhere(db, auth),
            memberId ? eq(healthMedications.memberId, memberId) : undefined,
          ),
        );
      const views = await loadSupplyViews(db, env, auth.householdId, meds);
      const today = await householdTodayIsoDate(db, auth.householdId);
      const acl = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);

      type Item = {
        id: string;
        memberId: string;
        name: string;
        dosage: string | null;
        canEdit: boolean;
        requestedDaysAgo: number | null;
        supply: SupplySummary;
      };
      const groups = new Map<string, { pharmacy: PharmacySummary | null; medications: Item[] }>();
      for (const med of meds) {
        const view = views.get(med.id);
        if (!view) continue;
        const { state } = view.supply;
        if (!all && state !== "needs_refill" && state !== "requested") continue;
        const key = view.pharmacy?.id ?? NO_PHARMACY;
        const group = groups.get(key) ?? { pharmacy: view.pharmacy, medications: [] };
        group.medications.push({
          id: med.id,
          memberId: med.memberId,
          name: decryptHealthFieldOrPassthrough(med.name, env) ?? "",
          dosage: decryptHealthFieldOrPassthrough(med.dosage, env),
          canEdit: canAccessHealthSegment(managementGrantsForSubject(acl, med.memberId, auth.memberId, auth.role), "medications", "write"),
          requestedDaysAgo: view.supply.requestedAt ? Math.max(0, daysBetween(view.supply.requestedAt.slice(0, 10), today)) : null,
          supply: view.supply,
        });
        groups.set(key, group);
      }

      // Soonest deadline first, inside a pharmacy and between pharmacies; no deadline last.
      const byDeadline = (a: string | null, b: string | null) => (a ?? "9999-12-31").localeCompare(b ?? "9999-12-31");
      const out = [...groups.values()].map((g) => ({
        pharmacy: g.pharmacy,
        medications: g.medications.sort((a, b) => byDeadline(a.supply.deadline, b.supply.deadline) || a.name.localeCompare(b.name)),
      }));
      out.sort((a, b) => {
        if ((a.pharmacy === null) !== (b.pharmacy === null)) return a.pharmacy === null ? 1 : -1;
        return byDeadline(a.medications[0]?.supply.deadline ?? null, b.medications[0]?.supply.deadline ?? null);
      });
      return c.json({ groups: out, today });
    } catch (e) {
      const resp = encryptionError(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  // Marks a refill Requested. Asking again changes nothing and says so.
  app.post("/medications/:id/supply/request", async (c) => {
    const auth = c.get("auth")!;
    const med = await loadMedication(auth, c.req.param("id"));
    if (!med) return c.json({ error: "medication_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "medications", "write"))) return c.json({ error: "forbidden" }, 403);
    if (!med.enabled) return c.json({ error: "medication_inactive" }, 409);

    try {
      await db.insert(healthMedicationSupply).values({ medicationId: med.id }).onConflictDoNothing();
      // Only a medication with no open request matches, so two people tapping at once record one event.
      const [claimed] = await db
        .update(healthMedicationSupply)
        .set({
          // The database clock at the moment the row is written. A request that waited behind a receipt
          // must not be stamped with the time it was received, which is before that receipt.
          requestedAt: sql`clock_timestamp()`,
          requestedByUserId: auth.userId,
          version: sql`${healthMedicationSupply.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(healthMedicationSupply.medicationId, med.id), isNull(healthMedicationSupply.requestedAt)))
        .returning({ pharmacyId: healthMedicationSupply.pharmacyId });
      if (claimed) {
        await db.insert(healthMedicationRefillEvents).values({
          medicationId: med.id,
          kind: "requested",
          pharmacyId: claimed.pharmacyId,
          createdByUserId: auth.userId,
        });
      }
      return c.json({ ...(await stateOf(auth, med)), alreadyRequested: !claimed });
    } catch (e) {
      const resp = encryptionError(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  // Drops an open request (asked by mistake, or no longer wanted). Nothing open: nothing changes.
  // Allowed for a paused medication too, so a stale request can still be cleaned up.
  app.delete("/medications/:id/supply/request", async (c) => {
    const auth = c.get("auth")!;
    const med = await loadMedication(auth, c.req.param("id"));
    if (!med) return c.json({ error: "medication_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "medications", "write"))) return c.json({ error: "forbidden" }, 403);

    try {
      const [cleared] = await db
        .update(healthMedicationSupply)
        .set({
          requestedAt: null,
          requestedByUserId: null,
          version: sql`${healthMedicationSupply.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(healthMedicationSupply.medicationId, med.id), sql`${healthMedicationSupply.requestedAt} is not null`))
        .returning({ pharmacyId: healthMedicationSupply.pharmacyId });
      if (cleared) {
        await db.insert(healthMedicationRefillEvents).values({
          medicationId: med.id,
          kind: "request_cleared",
          pharmacyId: cleared.pharmacyId,
          createdByUserId: auth.userId,
        });
      }
      return c.json({ ...(await stateOf(auth, med)), alreadyClear: !cleared });
    } catch (e) {
      const resp = encryptionError(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  // The refill arrived. `outsideDays` is the new total in hand outside the organizers; what the
  // organizers still hold is added, the estimate is replaced (a "receipt" revision) and the request closes.
  app.post("/medications/:id/supply/receive", async (c) => {
    const auth = c.get("auth")!;
    const parsed = parseReceive(await c.req.json().catch(() => null));
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);
    const body = parsed;

    const med = await loadMedication(auth, c.req.param("id"));
    if (!med) return c.json({ error: "medication_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "medications", "write"))) return c.json({ error: "forbidden" }, 403);
    if (!med.enabled) return c.json({ error: "medication_inactive" }, 409);

    try {
      const today = await householdTodayIsoDate(db, auth.householdId);

      if (body.dryRun) {
        const outcome = await computeEstimate(db, med.id, today, body);
        if (outcome.kind === "too_large") return c.json({ error: "supply_too_large" }, 400);
        if (outcome.kind === "needs_confirmation") {
          return c.json({ dryRun: true, needsConfirmation: true, organizerDays: outcome.organizerDays, organizerEndsOn: outcome.organizerEndsOn });
        }
        return c.json({ dryRun: true, needsConfirmation: false, ...outcome.estimate, estimatedOn: today });
      }

      // Take the row, so a request, another receipt or an edit arriving now waits its turn.
      await db.insert(healthMedicationSupply).values({ medicationId: med.id }).onConflictDoNothing();
      const [row] = await db
        .select()
        .from(healthMedicationSupply)
        .where(eq(healthMedicationSupply.medicationId, med.id))
        .for("update")
        .limit(1);
      if (!row) return c.json({ error: "version_conflict" }, 409);

      if (body.idempotencyKey && row.lastWriteKey === body.idempotencyKey) {
        return c.json({ ...(await stateOf(auth, med)), replayed: true });
      }
      if (body.version !== undefined && body.version !== row.version) {
        return c.json({ error: "version_conflict", ...(await stateOf(auth, med)) }, 409);
      }

      const outcome = await computeEstimate(db, med.id, today, body);
      if (outcome.kind === "too_large") return c.json({ error: "supply_too_large" }, 400);
      if (outcome.kind === "needs_confirmation") {
        return c.json({ error: "confirmation_required", organizerDays: outcome.organizerDays, organizerEndsOn: outcome.organizerEndsOn }, 409);
      }
      const estimate = outcome.estimate;

      const [saved] = await db
        .update(healthMedicationSupply)
        .set({
          runsOutOn: estimate.runsOutOn,
          estimatedOn: today,
          outsideDays: estimate.outsideDays,
          organizerDaysCounted: estimate.organizerDays,
          revision: sql`${healthMedicationSupply.revision} + 1`,
          version: sql`${healthMedicationSupply.version} + 1`,
          requestedAt: null,
          requestedByUserId: null,
          receivedAt: sql`clock_timestamp()`,
          lastWriteKey: body.idempotencyKey ?? null,
          updatedAt: new Date(),
        })
        .where(eq(healthMedicationSupply.medicationId, med.id))
        .returning();
      await db.insert(healthMedicationSupplyRevisions).values({
        medicationId: med.id,
        revision: saved.revision,
        source: "receipt",
        runsOutOn: estimate.runsOutOn,
        estimatedOn: today,
        outsideDays: estimate.outsideDays,
        organizerDaysCounted: estimate.organizerDays,
        createdByUserId: auth.userId,
      });
      await db.insert(healthMedicationRefillEvents).values({
        medicationId: med.id,
        kind: "received",
        pharmacyId: saved.pharmacyId,
        supplyRevision: saved.revision,
        createdByUserId: auth.userId,
      });
      return c.json(await stateOf(auth, med));
    } catch (e) {
      const resp = encryptionError(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  return app;
}
