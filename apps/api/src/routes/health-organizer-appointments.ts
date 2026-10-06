import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { addDaysUtc, daysBetween, isOrganizerOccurrenceDate, todayIsoDateInTz } from "@domi-ops/calendar-sync";
import type { Database } from "@domi-ops/db";
import { healthOrganizerOccurrenceEvents, healthOrganizerOccurrences, healthOrganizerPlans } from "@domi-ops/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { encryptHealthField, HealthEncryptionError } from "../lib/health-crypto.js";
import { hasHealthSegmentAccess } from "../lib/health-access.js";
import { householdTimezone } from "../lib/household-time.js";
import { isUuid, parseAnchorDate } from "../lib/health-organizer-validation.js";
import type { PlanRow } from "../lib/health-organizer-plan.js";
import {
  computeEffects,
  hasEffects,
  lastSettableDate,
  loadAppointment,
  loadAppointments,
  loadEvents,
  loadOccurrenceRow,
  planSchedule,
  type AppointmentView,
  type Outcome,
} from "../lib/health-organizer-appointments.js";

/**
 * Fill appointments and their outcomes (WHO-425), under a plan:
 *
 *   GET  /organizers/:planId/appointments?from=&to=      the appointments in a range (default: the last five weeks and the next dozen)
 *   GET  /organizers/:planId/appointments/:date          one, with its history and, when it matters, what it affects
 *   PUT  /organizers/:planId/appointments/:date          say what happened: done, skipped, missed, moved to another day, or back to pending
 *   POST /organizers/:planId/appointments/:date/resolve  "I have dealt with this": it stops being flagged
 *
 * `:date` is the day the schedule put the appointment on, whether or not it has since been moved. Moving one
 * changes only that appointment, never the plan's schedule. Reading needs `medications` read on the person,
 * changing needs write.
 */

const OUTCOMES = ["pending", "done", "skipped", "missed", "rescheduled"] as const;
const NOTE_MAX = 500;
const MAX_RANGE_DAYS = 400;
/** How far an appointment may be moved either way (the overview reads a year on each side to find moved ones). */
const MAX_MOVE_DAYS = 366;

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

type OutcomeBody = { outcome: Outcome; rescheduledTo: string | null; note: string | null; version: number };

function parseOutcomeBody(raw: unknown): OutcomeBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadInput("invalid_body");
  const b = raw as Record<string, unknown>;
  if (typeof b.outcome !== "string" || !(OUTCOMES as readonly string[]).includes(b.outcome)) throw new BadInput("invalid_outcome");
  const outcome = b.outcome as Outcome;
  if (typeof b.version !== "number" || !Number.isInteger(b.version) || b.version < 0 || b.version > 2_000_000_000) throw new BadInput("invalid_version");

  let rescheduledTo: string | null = null;
  if (outcome === "rescheduled") {
    if (b.rescheduledTo === undefined || b.rescheduledTo === null) throw new BadInput("reschedule_needs_date");
    try {
      rescheduledTo = parseAnchorDate(b.rescheduledTo);
    } catch {
      throw new BadInput("invalid_reschedule_date");
    }
  } else if (b.rescheduledTo !== undefined && b.rescheduledTo !== null) {
    throw new BadInput("reschedule_date_not_allowed");
  }

  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string" || b.note.trim().length > NOTE_MAX) throw new BadInput("invalid_note");
    note = b.note.trim() || null;
  }
  return { outcome, rescheduledTo, note, version: b.version };
}

export function healthOrganizerAppointmentRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  const failure = (c: Ctx, e: unknown): Response | null => {
    if (e instanceof BadInput) return c.json({ error: e.code }, e.status as 400);
    if (e instanceof HealthEncryptionError) return c.json({ error: "encryption_key_required", message: e.message }, 503);
    return null;
  };

  async function loadPlan(auth: Auth, planId: string): Promise<PlanRow | null> {
    if (!isUuid(planId)) return null;
    const [row] = await db
      .select()
      .from(healthOrganizerPlans)
      .where(and(eq(healthOrganizerPlans.id, planId), eq(healthOrganizerPlans.householdId, auth.householdId), isNull(healthOrganizerPlans.archivedAt)))
      .limit(1);
    return row ?? null;
  }

  /** The plan, if it exists and the caller may read (or write) its person's medications; otherwise the response to send. */
  async function planFor(c: Ctx, auth: Auth, planId: string, level: "read" | "write"): Promise<PlanRow | Response> {
    const plan = await loadPlan(auth, planId);
    if (!plan) return c.json({ error: "plan_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, plan.memberId, "medications", level))) return c.json({ error: "forbidden" }, 403);
    return plan;
  }

  async function bodyWithEffects(auth: Auth, plan: PlanRow, appointment: AppointmentView) {
    return hasEffects(appointment) ? { appointment, effects: await computeEffects(db, env, auth, plan, appointment) } : { appointment, effects: null };
  }

  app.get("/:planId/appointments", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "read");
    if (plan instanceof Response) return plan;
    try {
      const tz = await householdTimezone(db, auth.householdId);
      const today = todayIsoDateInTz(tz);
      const fromQ = c.req.query("from");
      const toQ = c.req.query("to");
      let from: string;
      let to: string;
      try {
        from = fromQ ? parseAnchorDate(fromQ) : addDaysUtc(today, -35);
        to = toQ ? parseAnchorDate(toQ) : lastSettableDate(plan, today);
      } catch {
        throw new BadInput("invalid_range");
      }
      if (to < from || daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadInput("invalid_range");
      const result = await loadAppointments(db, env, auth, plan, from, to);
      return c.json({ ...result, from, to, canEdit: await hasHealthSegmentAccess(db, auth, plan.memberId, "medications", "write") });
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.get("/:planId/appointments/:date", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "read");
    if (plan instanceof Response) return plan;
    try {
      const date = await settableDate(plan, c.req.param("date"), auth);
      const appointment = await loadAppointment(db, env, auth, plan, date);
      const row = await loadOccurrenceRow(db, plan.id, date);
      return c.json({
        ...(await bodyWithEffects(auth, plan, appointment)),
        events: row ? await loadEvents(db, env, row.id) : [],
      });
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  /** The appointment day, if the plan's schedule really puts one there (and not impossibly far ahead). */
  async function settableDate(plan: PlanRow, raw: string, auth: Auth): Promise<string> {
    let date: string;
    try {
      date = parseAnchorDate(raw);
    } catch {
      throw new BadInput("appointment_not_found", 404);
    }
    const today = todayIsoDateInTz(await householdTimezone(db, auth.householdId));
    if (!isOrganizerOccurrenceDate(planSchedule(plan), plan.anchorDate, date) || date > lastSettableDate(plan, today)) {
      throw new BadInput("appointment_not_found", 404);
    }
    return date;
  }

  app.put("/:planId/appointments/:date", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "write");
    if (plan instanceof Response) return plan;
    try {
      const body = parseOutcomeBody(await c.req.json().catch(() => null));
      const date = await settableDate(plan, c.req.param("date"), auth);

      if (body.rescheduledTo) {
        if (body.rescheduledTo === date) throw new BadInput("invalid_reschedule_date");
        if (Math.abs(daysBetween(date, body.rescheduledTo)) > MAX_MOVE_DAYS) throw new BadInput("invalid_reschedule_date");
        // Another appointment already on that day: one of the schedule's own that has not been moved away, or one moved there.
        const landing = await loadOccurrenceRow(db, plan.id, body.rescheduledTo);
        const scheduledThere = isOrganizerOccurrenceDate(planSchedule(plan), plan.anchorDate, body.rescheduledTo) && landing?.outcome !== "rescheduled";
        const [movedThere] = await db
          .select({ id: healthOrganizerOccurrences.id })
          .from(healthOrganizerOccurrences)
          .where(
            and(
              eq(healthOrganizerOccurrences.planId, plan.id),
              eq(healthOrganizerOccurrences.rescheduledTo, body.rescheduledTo),
              ne(healthOrganizerOccurrences.occurrenceDate, date),
            ),
          )
          .limit(1);
        if (scheduledThere || movedThere) throw new BadInput("date_taken", 409);
      }

      const existing = await loadOccurrenceRow(db, plan.id, date);
      const note = body.note ? encryptHealthField(body.note, env) : null;
      const currentOutcome = (existing?.outcome ?? "pending") as Outcome;

      // Saying again what is already so changes nothing and needs no version: a retry is harmless.
      const sameAsNow =
        currentOutcome === body.outcome &&
        (existing?.rescheduledTo ?? null) === body.rescheduledTo &&
        // notes are stored encrypted, so compare what the person would read
        (await loadAppointment(db, env, auth, plan, date)).note === body.note;
      if (sameAsNow) return c.json({ ...(await bodyWithEffects(auth, plan, await loadAppointment(db, env, auth, plan, date))), unchanged: true });

      if ((existing?.version ?? 0) !== body.version) {
        return c.json(
          { error: "version_conflict", ...(await bodyWithEffects(auth, plan, await loadAppointment(db, env, auth, plan, date))) },
          409,
        );
      }

      const changes = {
        outcome: body.outcome,
        rescheduledTo: body.rescheduledTo,
        note,
        resolvedAt: null,
        outcomeChangedAt: sql`clock_timestamp()`,
        outcomeChangedByUserId: auth.userId,
        updatedAt: new Date(),
      };
      let rowId: string | undefined;
      if (!existing) {
        const [created] = await db
          .insert(healthOrganizerOccurrences)
          .values({ planId: plan.id, occurrenceDate: date, ...changes, version: 1 })
          .onConflictDoNothing()
          .returning({ id: healthOrganizerOccurrences.id });
        rowId = created?.id;
      } else {
        // The version in the WHERE is what makes two simultaneous changes safe: the later one re-checks it after the first commits.
        const [updated] = await db
          .update(healthOrganizerOccurrences)
          .set({ ...changes, version: sql`${healthOrganizerOccurrences.version} + 1` })
          .where(and(eq(healthOrganizerOccurrences.id, existing.id), eq(healthOrganizerOccurrences.version, body.version)))
          .returning({ id: healthOrganizerOccurrences.id });
        rowId = updated?.id;
      }
      if (!rowId) {
        return c.json(
          { error: "version_conflict", ...(await bodyWithEffects(auth, plan, await loadAppointment(db, env, auth, plan, date))) },
          409,
        );
      }
      await db.insert(healthOrganizerOccurrenceEvents).values({
        occurrenceId: rowId,
        fromOutcome: currentOutcome,
        toOutcome: body.outcome,
        note,
        createdByUserId: auth.userId,
      });
      return c.json(await bodyWithEffects(auth, plan, await loadAppointment(db, env, auth, plan, date)));
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  // "I have looked at this and dealt with it": records the time so it stops being flagged. Changing the outcome later flags it again.
  app.post("/:planId/appointments/:date/resolve", async (c) => {
    const auth = c.get("auth")!;
    const plan = await planFor(c, auth, c.req.param("planId"), "write");
    if (plan instanceof Response) return plan;
    try {
      const date = await settableDate(plan, c.req.param("date"), auth);
      const current = await loadAppointment(db, env, auth, plan, date);
      if (current.resolvedAt) return c.json({ ...(await bodyWithEffects(auth, plan, current)), unchanged: true });
      if (!current.needsResolution) throw new BadInput("nothing_to_resolve", 409);

      const existing = await loadOccurrenceRow(db, plan.id, date);
      if (!existing) {
        await db
          .insert(healthOrganizerOccurrences)
          .values({ planId: plan.id, occurrenceDate: date, resolvedAt: sql`clock_timestamp()`, version: 1 })
          .onConflictDoNothing();
      } else {
        await db
          .update(healthOrganizerOccurrences)
          .set({ resolvedAt: sql`clock_timestamp()`, version: sql`${healthOrganizerOccurrences.version} + 1`, updatedAt: new Date() })
          .where(and(eq(healthOrganizerOccurrences.id, existing.id), isNull(healthOrganizerOccurrences.resolvedAt)));
      }
      return c.json(await bodyWithEffects(auth, plan, await loadAppointment(db, env, auth, plan, date)));
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  return app;
}
