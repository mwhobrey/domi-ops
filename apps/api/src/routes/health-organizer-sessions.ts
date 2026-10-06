import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { addDaysUtc, daysBetween, fillProgress, isOrganizerOccurrenceDate, nextUncoveredDay } from "@domi-ops/calendar-sync";
import type { Database } from "@domi-ops/db";
import {
  healthMedications,
  healthOrganizerOccurrences,
  healthOrganizerPlans,
  healthOrganizerSessionFills,
  healthOrganizerSessions,
} from "@domi-ops/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { HealthEncryptionError } from "../lib/health-crypto.js";
import { filterVisibleMedicationIds, hasHealthSegmentAccess } from "../lib/health-access.js";
import { householdTodayIsoDate } from "../lib/household-time.js";
import { CapExceededError, HEALTH_CAPS, assertRoomFor, lockQuota } from "../lib/health-quota.js";
import { isUuid, parseAnchorDate, parseFillLength } from "../lib/health-organizer-validation.js";
import type { PlanRow } from "../lib/health-organizer-plan.js";
import { lastSettableDate, planSchedule } from "../lib/health-organizer-appointments.js";
import { computeEstimate } from "../lib/health-supply.js";
import {
  applyFillEstimate,
  buildSnapshot,
  currentHash,
  decodeSnapshot,
  encodeSnapshot,
  fillView,
  loadCoverage,
  loadSessionView,
  restoreEstimateBefore,
  type SessionRow,
} from "../lib/health-organizer-session.js";

/**
 * Filling sessions (WHO-426), under a plan. A session is one sitting at the pill organizer: it starts from the
 * instructions as they are then (a snapshot), records each medication as it is filled, and ends.
 *
 *   GET  /organizers/:planId/sessions/defaults            where the next session would start, and how long it would be
 *   GET  /organizers/:planId/sessions/current             the open session, if there is one
 *   GET  /organizers/:planId/sessions                     recent sessions
 *   POST /organizers/:planId/sessions                     start one (or get the open one back: there is one per plan)
 *   GET  /organizers/:planId/sessions/:id                 a session with how far along each medication is
 *   POST /organizers/:planId/sessions/:id/fills           record one medication filled for a stretch of days, and the supply it leaves
 *   POST /organizers/:planId/sessions/:id/fills/:fillId/undo   take back a medication's latest fill
 *   POST /organizers/:planId/sessions/:id/review          accept the instructions as they are now, after they changed
 *   POST /organizers/:planId/sessions/:id/finish          done: creates no dose records
 *   POST /organizers/:planId/sessions/:id/abandon         stop; what was filled stays counted
 *
 * Reading needs `medications` read on the person, everything else write. Changes need the session's `version`; a
 * fill also carries a key, so sending it twice records it once.
 */

const KEY_MAX = 100;

type Auth = { userId: string; householdId: string; memberId: string; role: string };
type Ctx = { json: (body: unknown, status?: number) => Response };

class BadInput extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
  }
}

const isWhole = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

type FillBody = {
  medicationId: string;
  coveredFrom: string;
  coveredTo: string;
  outsideDays: number;
  confirmedTotalDays?: number;
  idempotencyKey: string;
  version: number;
  dryRun: boolean;
};

function parseFillBody(raw: unknown): FillBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadInput("invalid_body");
  const b = raw as Record<string, unknown>;
  if (!isUuid(b.medicationId)) throw new BadInput("medication_not_found", 404);
  let coveredFrom: string;
  let coveredTo: string;
  try {
    coveredFrom = parseAnchorDate(b.coveredFrom);
    coveredTo = parseAnchorDate(b.coveredTo);
  } catch {
    throw new BadInput("invalid_range");
  }
  if (coveredTo < coveredFrom) throw new BadInput("invalid_range");
  if (!isWhole(b.outsideDays, 0, 3650)) throw new BadInput("invalid_outside_days");
  if (b.confirmedTotalDays !== undefined && !isWhole(b.confirmedTotalDays, 0, 3650)) throw new BadInput("invalid_confirmed_total");
  if (typeof b.idempotencyKey !== "string" || !b.idempotencyKey.trim() || b.idempotencyKey.length > KEY_MAX) throw new BadInput("invalid_idempotency_key");
  const dryRun = b.dryRun === true;
  if (b.dryRun !== undefined && typeof b.dryRun !== "boolean") throw new BadInput("invalid_body");
  if (!isWhole(b.version, 1, 2_000_000_000)) throw new BadInput("invalid_version");
  return {
    medicationId: b.medicationId.toLowerCase(),
    coveredFrom,
    coveredTo,
    outsideDays: b.outsideDays,
    confirmedTotalDays: b.confirmedTotalDays as number | undefined,
    idempotencyKey: b.idempotencyKey,
    version: b.version,
    dryRun,
  };
}

function parseVersionBody(raw: unknown): number {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>).version : undefined;
  if (!isWhole(v, 1, 2_000_000_000)) throw new BadInput("invalid_version");
  return v;
}

export function healthOrganizerSessionRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  const failure = (c: Ctx, e: unknown): Response | null => {
    if (e instanceof BadInput) return c.json({ error: e.code }, e.status as 400);
    if (e instanceof CapExceededError) return c.json({ error: e.code, max: e.max }, 409);
    if (e instanceof HealthEncryptionError) return c.json({ error: "encryption_key_required", message: e.message }, 503);
    return null;
  };

  async function planFor(c: Ctx, auth: Auth, planId: string, level: "read" | "write"): Promise<PlanRow | Response> {
    if (!isUuid(planId)) return c.json({ error: "plan_not_found" }, 404);
    const [plan] = await db
      .select()
      .from(healthOrganizerPlans)
      .where(and(eq(healthOrganizerPlans.id, planId), eq(healthOrganizerPlans.householdId, auth.householdId), isNull(healthOrganizerPlans.archivedAt)))
      .limit(1);
    if (!plan) return c.json({ error: "plan_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, plan.memberId, "medications", level))) return c.json({ error: "forbidden" }, 403);
    return plan;
  }

  async function sessionRow(plan: PlanRow, id: string, lock = false): Promise<SessionRow | null> {
    if (!isUuid(id)) return null;
    const q = db
      .select()
      .from(healthOrganizerSessions)
      .where(and(eq(healthOrganizerSessions.id, id), eq(healthOrganizerSessions.planId, plan.id)));
    const [row] = await (lock ? q.for("update") : q).limit(1);
    return row ?? null;
  }

  const view = (auth: Auth, plan: PlanRow, session: SessionRow) => loadSessionView(db, env, auth, plan, session);

  /** Every stretch filled for any of the person's medications, for working out where the next session starts. */
  async function planCoverageRanges(plan: PlanRow) {
    const meds = await db
      .select({ id: healthMedications.id })
      .from(healthMedications)
      .where(and(eq(healthMedications.householdId, plan.householdId), eq(healthMedications.memberId, plan.memberId), isNull(healthMedications.deletedAt)));
    const byMed = await loadCoverage(db, meds.map((m) => m.id));
    return [...byMed.values()].flat();
  }

  async function openSessionOf(plan: PlanRow): Promise<SessionRow | null> {
    const [open] = await db
      .select()
      .from(healthOrganizerSessions)
      .where(and(eq(healthOrganizerSessions.planId, plan.id), eq(healthOrganizerSessions.status, "open")))
      .limit(1);
    return open ?? null;
  }

  app.get("/:planId/sessions/defaults", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "read");
    if (plan instanceof Response) return plan;
    const today = await householdTodayIsoDate(db, auth.householdId);
    const open = await openSessionOf(plan);
    return c.json({
      today,
      coverageStart: nextUncoveredDay(await planCoverageRanges(plan), today),
      fillLengthDays: plan.fillLengthDays,
      openSessionId: open?.id ?? null,
    });
  });

  app.get("/:planId/sessions/current", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "read");
    if (plan instanceof Response) return plan;
    try {
      const open = await openSessionOf(plan);
      return c.json({ session: open ? await view(auth, plan, open) : null });
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.get("/:planId/sessions", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "read");
    if (plan instanceof Response) return plan;
    const rows = await db
      .select()
      .from(healthOrganizerSessions)
      .where(eq(healthOrganizerSessions.planId, plan.id))
      .orderBy(desc(healthOrganizerSessions.startedAt))
      .limit(HEALTH_CAPS.sessionsPerPerson.max);
    return c.json({
      sessions: rows.map((s) => ({
        id: s.id,
        status: s.status,
        version: s.version,
        coverageStart: s.coverageStart,
        coverageEnd: addDaysUtc(s.coverageStart, s.fillLengthDays - 1),
        fillLengthDays: s.fillLengthDays,
        startedAt: s.startedAt.toISOString(),
        finishedAt: s.finishedAt?.toISOString() ?? null,
        abandonedAt: s.abandonedAt?.toISOString() ?? null,
      })),
    });
  });

  app.get("/:planId/sessions/:id", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "read");
    if (plan instanceof Response) return plan;
    try {
      const session = await sessionRow(plan, c.req.param("id"));
      if (!session) return c.json({ error: "session_not_found" }, 404);
      return c.json({ session: await view(auth, plan, session) });
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/:planId/sessions", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "write");
    if (plan instanceof Response) return plan;
    try {
      const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown> | null;
      const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

      // One session being started at a time per plan; and a second request for one gets the first back.
      await db.select({ id: healthOrganizerPlans.id }).from(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, plan.id)).for("update");
      const already = await openSessionOf(plan);
      if (already) return c.json({ session: await view(auth, plan, already), existing: true });

      const today = await householdTodayIsoDate(db, auth.householdId);
      let coverageStart: string;
      try {
        coverageStart = body.coverageStart !== undefined ? parseAnchorDate(body.coverageStart) : nextUncoveredDay(await planCoverageRanges(plan), today);
      } catch {
        throw new BadInput("invalid_coverage_start");
      }
      if (daysBetween(today, coverageStart) < -31 || daysBetween(today, coverageStart) > 366) throw new BadInput("invalid_coverage_start");
      let fillLengthDays: number;
      try {
        fillLengthDays = body.fillLengthDays !== undefined ? parseFillLength(body.fillLengthDays) : plan.fillLengthDays;
      } catch {
        throw new BadInput("invalid_fill_length");
      }

      let occurrenceDate: string | null = null;
      if (body.occurrenceDate !== undefined && body.occurrenceDate !== null) {
        let date: string;
        try {
          date = parseAnchorDate(body.occurrenceDate);
        } catch {
          throw new BadInput("appointment_not_found", 404);
        }
        if (!isOrganizerOccurrenceDate(planSchedule(plan), plan.anchorDate, date) || date > lastSettableDate(plan, today)) {
          throw new BadInput("appointment_not_found", 404);
        }
        occurrenceDate = date;
      }

      await lockQuota(db, `sessions:${plan.memberId}`);
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(healthOrganizerSessions)
        .innerJoin(healthOrganizerPlans, eq(healthOrganizerPlans.id, healthOrganizerSessions.planId))
        .where(eq(healthOrganizerPlans.memberId, plan.memberId));
      assertRoomFor(n, HEALTH_CAPS.sessionsPerPerson);

      const built = await buildSnapshot(db, env, plan, coverageStart, fillLengthDays);
      if (built.errors.length > 0) {
        // Say which medications and times, but only those the person may see.
        const ids = new Set<string>();
        for (const p of built.errors) for (const id of "medicationIds" in p ? p.medicationIds : [p.medicationId]) ids.add(id);
        const visible = await filterVisibleMedicationIds(db, auth, [...ids]);
        const problems = built.errors
          .map((p) => ("medicationIds" in p ? { ...p, medicationIds: p.medicationIds.filter((id) => visible.has(id)) } : p))
          .filter((p) => ("medicationIds" in p ? p.medicationIds.length > 0 : visible.has(p.medicationId)));
        return c.json({ error: "setup_incomplete", problems }, 409);
      }
      if (built.placements.length === 0) return c.json({ error: "nothing_to_fill" }, 409);

      // Only now that the start is accepted: a refused start (these are answers, not errors, so nothing is rolled back)
      // must not leave a row behind for the appointment, which would make a version the person loaded stale.
      let occurrenceId: string | null = null;
      if (occurrenceDate) {
        const [existing] = await db
          .select({ id: healthOrganizerOccurrences.id })
          .from(healthOrganizerOccurrences)
          .where(and(eq(healthOrganizerOccurrences.planId, plan.id), eq(healthOrganizerOccurrences.occurrenceDate, occurrenceDate)))
          .limit(1);
        if (existing) {
          occurrenceId = existing.id;
        } else {
          const [made] = await db
            .insert(healthOrganizerOccurrences)
            .values({ planId: plan.id, occurrenceDate, version: 1 })
            .onConflictDoNothing()
            .returning({ id: healthOrganizerOccurrences.id });
          if (made) {
            occurrenceId = made.id;
          } else {
            // Lost an insert race for the same day: take the row that won, so the session is still linked to the appointment.
            // (Holding the plan row above already keeps anything else from inserting one meanwhile; this is the safety net.)
            const [winner] = await db
              .select({ id: healthOrganizerOccurrences.id })
              .from(healthOrganizerOccurrences)
              .where(and(eq(healthOrganizerOccurrences.planId, plan.id), eq(healthOrganizerOccurrences.occurrenceDate, occurrenceDate)))
              .limit(1);
            occurrenceId = winner?.id ?? null;
          }
        }
      }

      const [created] = await db
        .insert(healthOrganizerSessions)
        .values({
          planId: plan.id,
          occurrenceId,
          coverageStart,
          fillLengthDays,
          snapshotJson: encodeSnapshot(env, built.data),
          snapshotHash: built.hash,
          startedByUserId: auth.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        const winner = await openSessionOf(plan);
        if (winner) return c.json({ session: await view(auth, plan, winner), existing: true });
        throw new Error("could not start the session");
      }
      return c.json({ session: await view(auth, plan, created), existing: false }, 201);
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  /**
   * Common to every change to an open session: lock it, check it is open, and say if the instructions have changed since it
   * started. Returns the locked row, or the response to send.
   */
  async function lockOpen(c: Ctx, plan: PlanRow, auth: Auth, id: string): Promise<SessionRow | Response> {
    const session = await sessionRow(plan, id, true);
    if (!session) return c.json({ error: "session_not_found" }, 404);
    if (session.status !== "open") return c.json({ error: "session_not_open", session: await view(auth, plan, session) }, 409);
    return session;
  }

  app.post("/:planId/sessions/:id/fills", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "write");
    if (plan instanceof Response) return plan;
    try {
      const body = parseFillBody(await c.req.json().catch(() => null));

      // Lock the session first: two requests carrying the same key then run one after the other, and the second finds the first.
      const locked = await sessionRow(plan, c.req.param("id"), true);
      if (!locked) return c.json({ error: "session_not_found" }, 404);

      const [replay] = await db
        .select()
        .from(healthOrganizerSessionFills)
        .where(and(eq(healthOrganizerSessionFills.sessionId, locked.id), eq(healthOrganizerSessionFills.idempotencyKey, body.idempotencyKey)))
        .limit(1);
      if (replay) {
        if (replay.medicationId !== body.medicationId || replay.coveredFrom !== body.coveredFrom || replay.coveredTo !== body.coveredTo) {
          return c.json({ error: "idempotency_key_reused" }, 409);
        }
        return c.json({ session: await view(auth, plan, locked), fill: fillView(replay), replayed: true });
      }

      if (locked.status !== "open") return c.json({ error: "session_not_open", session: await view(auth, plan, locked) }, 409);
      const snapshot = decodeSnapshot(env, locked.snapshotJson);

      // The instructions must still be the ones this session started with.
      const now = await currentHash(db, plan, locked);
      if (now.hash !== locked.snapshotHash) return c.json({ error: "review_required", session: await view(auth, plan, locked) }, 409);

      if (!snapshot.medications[body.medicationId]) throw new BadInput("medication_not_found", 404);
      const visible = await filterVisibleMedicationIds(db, auth, [body.medicationId]);
      if (!visible.has(body.medicationId)) throw new BadInput("medication_not_found", 404);

      const windowEnd = addDaysUtc(locked.coverageStart, locked.fillLengthDays - 1);
      if (body.coveredFrom < locked.coverageStart || body.coveredTo > windowEnd) throw new BadInput("range_outside_session");

      const today = await householdTodayIsoDate(db, auth.householdId);
      const outcome = await computeEstimate(
        db,
        body.medicationId,
        today,
        { outsideDays: body.outsideDays, confirmedTotalDays: body.confirmedTotalDays },
        [{ from: body.coveredFrom, to: body.coveredTo }],
      );
      if (outcome.kind === "too_large") throw new BadInput("supply_too_large");
      if (outcome.kind === "needs_confirmation") {
        const info = { organizerDays: outcome.organizerDays, organizerEndsOn: outcome.organizerEndsOn };
        if (body.dryRun) return c.json({ dryRun: true, needsConfirmation: true, ...info });
        return c.json({ error: "confirmation_required", ...info }, 409);
      }

      if (body.dryRun) {
        const before = await loadCoverage(db, [body.medicationId]);
        const dates = snapshot.placements.filter((p) => p[0] === body.medicationId).map((p) => p[1]);
        return c.json({
          dryRun: true,
          needsConfirmation: false,
          ...outcome.estimate,
          estimatedOn: today,
          progressAfter: fillProgress(dates, [...(before.get(body.medicationId) ?? []), { from: body.coveredFrom, to: body.coveredTo }]),
        });
      }

      if (locked.version !== body.version) {
        return c.json({ error: "version_conflict", session: await view(auth, plan, locked) }, 409);
      }

      const [fill] = await db
        .insert(healthOrganizerSessionFills)
        .values({
          sessionId: locked.id,
          medicationId: body.medicationId,
          coveredFrom: body.coveredFrom,
          coveredTo: body.coveredTo,
          idempotencyKey: body.idempotencyKey,
          outsideDays: outcome.estimate.outsideDays,
          createdByUserId: auth.userId,
        })
        .returning();
      const revision = await applyFillEstimate(db, { medicationId: body.medicationId, estimate: outcome.estimate, today, sessionId: locked.id, userId: auth.userId });
      const [stamped] = await db
        .update(healthOrganizerSessionFills)
        .set({ supplyRevision: revision })
        .where(eq(healthOrganizerSessionFills.id, fill!.id))
        .returning();
      const [bumped] = await db
        .update(healthOrganizerSessions)
        .set({ version: sql`${healthOrganizerSessions.version} + 1`, updatedAt: new Date() })
        .where(eq(healthOrganizerSessions.id, locked.id))
        .returning();
      return c.json({
        session: await view(auth, plan, bumped!),
        fill: fillView(stamped!),
        supply: { runsOutOn: outcome.estimate.runsOutOn, estimatedOn: today, outsideDays: outcome.estimate.outsideDays, organizerDays: outcome.estimate.organizerDays, revision },
        replayed: false,
      });
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/:planId/sessions/:id/fills/:fillId/undo", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "write");
    if (plan instanceof Response) return plan;
    try {
      const version = parseVersionBody(await c.req.json().catch(() => null));
      const session = await lockOpen(c, plan, auth, c.req.param("id"));
      if (session instanceof Response) return session;
      const fillId = c.req.param("fillId");
      if (!isUuid(fillId)) return c.json({ error: "fill_not_found" }, 404);
      const [fill] = await db
        .select()
        .from(healthOrganizerSessionFills)
        .where(and(eq(healthOrganizerSessionFills.id, fillId), eq(healthOrganizerSessionFills.sessionId, session.id)))
        .limit(1);
      if (!fill) return c.json({ error: "fill_not_found" }, 404);
      const visible = await filterVisibleMedicationIds(db, auth, [fill.medicationId]);
      if (!visible.has(fill.medicationId)) return c.json({ error: "fill_not_found" }, 404);
      if (fill.undoneAt) return c.json({ session: await view(auth, plan, session), unchanged: true });
      if (session.version !== version) return c.json({ error: "version_conflict", session: await view(auth, plan, session) }, 409);

      const [latest] = await db
        .select({ id: healthOrganizerSessionFills.id })
        .from(healthOrganizerSessionFills)
        .where(
          and(
            eq(healthOrganizerSessionFills.sessionId, session.id),
            eq(healthOrganizerSessionFills.medicationId, fill.medicationId),
            isNull(healthOrganizerSessionFills.undoneAt),
          ),
        )
        .orderBy(desc(healthOrganizerSessionFills.createdAt), desc(healthOrganizerSessionFills.id))
        .limit(1);
      if (latest?.id !== fill.id) return c.json({ error: "not_last_fill", session: await view(auth, plan, session) }, 409);

      await db.update(healthOrganizerSessionFills).set({ undoneAt: new Date() }).where(eq(healthOrganizerSessionFills.id, fill.id));
      const supplyRestored =
        fill.supplyRevision !== null
          ? await restoreEstimateBefore(db, { medicationId: fill.medicationId, fillRevision: fill.supplyRevision, sessionId: session.id, userId: auth.userId })
          : false;
      const [bumped] = await db
        .update(healthOrganizerSessions)
        .set({ version: sql`${healthOrganizerSessions.version} + 1`, updatedAt: new Date() })
        .where(eq(healthOrganizerSessions.id, session.id))
        .returning();
      return c.json({ session: await view(auth, plan, bumped!), supplyRestored });
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/:planId/sessions/:id/review", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "write");
    if (plan instanceof Response) return plan;
    try {
      const version = parseVersionBody(await c.req.json().catch(() => null));
      const session = await lockOpen(c, plan, auth, c.req.param("id"));
      if (session instanceof Response) return session;
      if (session.version !== version) return c.json({ error: "version_conflict", session: await view(auth, plan, session) }, 409);

      const before = await view(auth, plan, session);
      const built = await buildSnapshot(db, env, plan, session.coverageStart, session.fillLengthDays);
      if (built.errors.length > 0) return c.json({ error: "setup_incomplete" }, 409);
      if (built.placements.length === 0) return c.json({ error: "nothing_to_fill" }, 409);

      const [updated] = await db
        .update(healthOrganizerSessions)
        .set({ snapshotJson: encodeSnapshot(env, built.data), snapshotHash: built.hash, version: sql`${healthOrganizerSessions.version} + 1`, updatedAt: new Date() })
        .where(eq(healthOrganizerSessions.id, session.id))
        .returning();
      return c.json({ session: await view(auth, plan, updated!), changes: before.changes });
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  async function close(c: Ctx, auth: Auth, plan: PlanRow, id: string, rawBody: unknown, to: "finished" | "abandoned"): Promise<Response> {
    const version = parseVersionBody(rawBody);
    const session = await sessionRow(plan, id, true);
    if (!session) return c.json({ error: "session_not_found" }, 404);
    if (session.status === to) return c.json({ session: await view(auth, plan, session), unchanged: true });
    if (session.status !== "open") return c.json({ error: "session_not_open", session: await view(auth, plan, session) }, 409);
    if (session.version !== version) return c.json({ error: "version_conflict", session: await view(auth, plan, session) }, 409);

    if (to === "finished") {
      const [anyFill] = await db
        .select({ id: healthOrganizerSessionFills.id })
        .from(healthOrganizerSessionFills)
        .where(and(eq(healthOrganizerSessionFills.sessionId, session.id), isNull(healthOrganizerSessionFills.undoneAt)))
        .limit(1);
      if (!anyFill) return c.json({ error: "nothing_filled", session: await view(auth, plan, session) }, 409);
    }
    const [updated] = await db
      .update(healthOrganizerSessions)
      .set({
        status: to,
        ...(to === "finished" ? { finishedAt: new Date() } : { abandonedAt: new Date() }),
        version: sql`${healthOrganizerSessions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(healthOrganizerSessions.id, session.id), eq(healthOrganizerSessions.status, "open")))
      .returning();
    return c.json({ session: await view(auth, plan, updated!) });
  }

  app.post("/:planId/sessions/:id/finish", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "write");
    if (plan instanceof Response) return plan;
    try {
      return await close(c, auth, plan, c.req.param("id"), await c.req.json().catch(() => null), "finished");
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/:planId/sessions/:id/abandon", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "write");
    if (plan instanceof Response) return plan;
    try {
      return await close(c, auth, plan, c.req.param("id"), await c.req.json().catch(() => null), "abandoned");
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  return app;
}
