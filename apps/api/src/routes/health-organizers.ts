import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  healthMedicationGroups,
  healthOrganizerCompartments,
  healthOrganizerPlanCaregivers,
  healthOrganizerPlans,
  healthOrganizerSessions,
  healthOrganizerTimeMap,
  householdMembers,
} from "@domi-ops/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { HealthEncryptionError } from "../lib/health-crypto.js";
import { hasHealthSegmentAccess, healthMedicationGroupVisibleWhere } from "../lib/health-access.js";
import { householdTodayIsoDate } from "../lib/household-time.js";
import { ReferenceNotFoundError, requireInHousehold } from "../lib/health-references.js";
import { scheduledTimes } from "../lib/health-dose-quantities.js";
import { loadPlanView, type PlanRow } from "../lib/health-organizer-plan.js";
import {
  DEFAULT_FILL_LENGTH_DAYS,
  DEFAULT_REMINDER_TIME,
  OrganizerValidationError,
  isUuid,
  parseAnchorDate,
  parseCaregivers,
  parseCompartments,
  parseFillLength,
  parseGroupAssignment,
  parseNewCompartmentNames,
  parseReminderTime,
  parseTimeMap,
  parseVersion,
  resolveSchedule,
  type CompartmentInput,
  type PlanSchedule,
} from "../lib/health-organizer-validation.js";

/**
 * Pill organizer plans (WHO-424): the one plan per person that says how they fill an organizer.
 *
 *   GET    /organizers?memberId=      the person's plan (or null) with what is still missing before filling works
 *   POST   /organizers                create it: schedule, compartments (four by default), who is reminded
 *   PATCH  /organizers/:id            change any of it; needs the version you saw
 *   DELETE /organizers/:id            archive it (history is kept); refused while a filling session is open
 *
 * Permissions follow the person's medications: read to see the plan, write to configure it.
 * Pill quantities are entered through the medication endpoints (WHO-417); this plan reports where they are
 * missing. Everything in a request is validated before anything is written.
 */

type Auth = { userId: string; householdId: string; memberId: string; role: string };
type Ctx = { json: (body: unknown, status?: number) => Response };

class CaregiverAccessError extends Error {}

export function healthOrganizerRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  const failure = (c: Ctx, e: unknown): Response | null => {
    if (e instanceof OrganizerValidationError) return c.json({ error: e.code }, e.code === "too_many_compartments" ? 409 : 400);
    if (e instanceof ReferenceNotFoundError) return c.json({ error: e.code }, 404);
    if (e instanceof HealthEncryptionError) return c.json({ error: "encryption_key_required", message: e.message }, 503);
    return null;
  };

  async function activePlanFor(memberId: string): Promise<PlanRow | null> {
    const [row] = await db
      .select()
      .from(healthOrganizerPlans)
      .where(and(eq(healthOrganizerPlans.memberId, memberId), isNull(healthOrganizerPlans.archivedAt)))
      .limit(1);
    return row ?? null;
  }

  /** Every caregiver must be a member of the household who may at least read the person's medications. */
  async function assertCaregiversMayRead(auth: Auth, planMemberId: string, caregiverIds: string[]): Promise<void> {
    if (caregiverIds.length === 0) return;
    await requireInHousehold(db, auth.householdId, { caregivers: caregiverIds });
    const rows = await db
      .select({ id: householdMembers.id, role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, auth.householdId), inArray(householdMembers.id, caregiverIds)));
    for (const row of rows) {
      const mayRead = await hasHealthSegmentAccess(
        db,
        { householdId: auth.householdId, memberId: row.id, role: row.role },
        planMemberId,
        "medications",
        "read",
      );
      if (!mayRead) throw new CaregiverAccessError();
    }
  }

  async function viewOf(auth: Auth, plan: PlanRow): Promise<unknown> {
    const canEdit = await hasHealthSegmentAccess(db, auth, plan.memberId, "medications", "write");
    return loadPlanView(db, auth, plan, canEdit);
  }

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const memberId = c.req.query("memberId");
    if (!memberId || !isUuid(memberId)) return c.json({ error: "member_not_found" }, 404);
    try {
      await requireInHousehold(db, auth.householdId, { members: [memberId] });
      if (!(await hasHealthSegmentAccess(db, auth, memberId, "medications", "read"))) return c.json({ error: "forbidden" }, 403);
      const plan = await activePlanFor(memberId);
      const canEdit = await hasHealthSegmentAccess(db, auth, memberId, "medications", "write");
      return c.json({ plan: plan ? await loadPlanView(db, auth, plan, canEdit) : null, canEdit });
    } catch (e) {
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid_body" }, 400);
    const memberId = body.memberId;
    if (!isUuid(memberId)) return c.json({ error: "member_not_found" }, 404);

    try {
      await requireInHousehold(db, auth.householdId, { members: [memberId] });
      if (!(await hasHealthSegmentAccess(db, auth, memberId, "medications", "write"))) return c.json({ error: "forbidden" }, 403);

      const schedule = resolveSchedule(null, body);
      const anchorDate = body.anchorDate !== undefined ? parseAnchorDate(body.anchorDate) : await householdTodayIsoDate(db, auth.householdId);
      const fillLengthDays = body.fillLengthDays !== undefined ? parseFillLength(body.fillLengthDays) : DEFAULT_FILL_LENGTH_DAYS;
      const reminderTime = body.reminderTime !== undefined ? parseReminderTime(body.reminderTime) : DEFAULT_REMINDER_TIME;
      const names = parseNewCompartmentNames(body.compartments);
      const caregivers = body.caregiverMemberIds !== undefined ? parseCaregivers(body.caregiverMemberIds) : [auth.memberId];
      await assertCaregiversMayRead(auth, memberId, caregivers);

      const existing = await activePlanFor(memberId);
      if (existing) return c.json({ error: "plan_exists", plan: await viewOf(auth, existing) }, 409);

      // ON CONFLICT rather than catching the unique violation: an error would abort the whole request's transaction.
      const [plan] = await db
        .insert(healthOrganizerPlans)
        .values({
          householdId: auth.householdId,
          memberId,
          ...schedule,
          anchorDate,
          fillLengthDays,
          reminderTime,
          createdByUserId: auth.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!plan) {
        const winner = await activePlanFor(memberId);
        return c.json({ error: "plan_exists", ...(winner ? { plan: await viewOf(auth, winner) } : {}) }, 409);
      }
      await db.insert(healthOrganizerCompartments).values(names.map((name, position) => ({ planId: plan.id, name, position })));
      if (caregivers.length > 0) {
        await db.insert(healthOrganizerPlanCaregivers).values(caregivers.map((id) => ({ planId: plan.id, memberId: id })));
      }
      return c.json({ plan: await viewOf(auth, plan) }, 201);
    } catch (e) {
      if (e instanceof CaregiverAccessError) return c.json({ error: "caregiver_no_access" }, 400);
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid_body" }, 400);
    if (!isUuid(id)) return c.json({ error: "plan_not_found" }, 404);

    try {
      const [plan] = await db
        .select()
        .from(healthOrganizerPlans)
        .where(and(eq(healthOrganizerPlans.id, id), isNull(healthOrganizerPlans.archivedAt)))
        .limit(1);
      if (!plan || plan.householdId !== auth.householdId) return c.json({ error: "plan_not_found" }, 404);
      if (!(await hasHealthSegmentAccess(db, auth, plan.memberId, "medications", "write"))) return c.json({ error: "forbidden" }, 403);

      // ---- validate everything first
      const version = parseVersion(body.version);
      const touchesSchedule = ["scheduleKind", "everyN", "monthlyDay"].some((k) => body[k] !== undefined);
      const schedule = touchesSchedule
        ? resolveSchedule(
            plan.scheduleKind === "every_n_days"
              ? { scheduleKind: "every_n_days", everyN: plan.everyN as number, monthlyDay: null }
              : ({ scheduleKind: "monthly_date", monthlyDay: plan.monthlyDay as number, everyN: null } satisfies PlanSchedule),
            body,
          )
        : null;
      const anchorDate = body.anchorDate !== undefined ? parseAnchorDate(body.anchorDate) : undefined;
      const fillLengthDays = body.fillLengthDays !== undefined ? parseFillLength(body.fillLengthDays) : undefined;
      const reminderTime = body.reminderTime !== undefined ? parseReminderTime(body.reminderTime) : undefined;
      const compartments: CompartmentInput[] | undefined = body.compartments !== undefined ? parseCompartments(body.compartments) : undefined;
      const timeMap = body.timeMap !== undefined ? parseTimeMap(body.timeMap) : undefined;
      const assignment = body.assignGroup !== undefined ? parseGroupAssignment(body.assignGroup) : undefined;
      const caregivers = body.caregiverMemberIds !== undefined ? parseCaregivers(body.caregiverMemberIds) : undefined;

      const touched = [schedule, anchorDate, fillLengthDays, reminderTime, compartments, timeMap, assignment, caregivers].some((v) => v !== undefined && v !== null);
      if (!touched) return c.json({ error: "nothing_to_change" }, 400);

      const existingCompartments = await db
        .select()
        .from(healthOrganizerCompartments)
        .where(eq(healthOrganizerCompartments.planId, plan.id))
        .orderBy(asc(healthOrganizerCompartments.position));
      const existingIds = new Set(existingCompartments.map((x) => x.id));
      if (compartments) {
        for (const entry of compartments) if (entry.id && !existingIds.has(entry.id.toLowerCase())) throw new OrganizerValidationError("compartment_not_found");
      }
      // The compartments the plan will have, as far as ids already known: a time can only go to one of these.
      const finalKnownIds = new Set(compartments ? compartments.filter((x) => x.id).map((x) => x.id!.toLowerCase()) : existingIds);
      for (const target of timeMap?.values() ?? []) if (!finalKnownIds.has(target)) throw new OrganizerValidationError("compartment_not_found");

      let groupTimes: string[] = [];
      if (assignment) {
        if (!finalKnownIds.has(assignment.compartmentId)) throw new OrganizerValidationError("compartment_not_found");
        const [group] = await db
          .select()
          .from(healthMedicationGroups)
          .where(
            and(
              eq(healthMedicationGroups.id, assignment.groupId),
              eq(healthMedicationGroups.memberId, plan.memberId),
              healthMedicationGroupVisibleWhere(db, auth),
            ),
          )
          .limit(1);
        if (!group) throw new ReferenceNotFoundError("group_not_found");
        groupTimes = group.scheduleKind === "scheduled" ? scheduledTimes("scheduled", group.scheduleJson) : [];
        if (groupTimes.length === 0) throw new OrganizerValidationError("invalid_group_assignment");
      }
      if (caregivers) await assertCaregiversMayRead(auth, plan.memberId, caregivers);

      // ---- write: the plan row first, so the version check also takes the row lock for everything after
      const [updated] = await db
        .update(healthOrganizerPlans)
        .set({
          ...(schedule ?? {}),
          ...(anchorDate !== undefined ? { anchorDate } : {}),
          ...(fillLengthDays !== undefined ? { fillLengthDays } : {}),
          ...(reminderTime !== undefined ? { reminderTime } : {}),
          version: sql`${healthOrganizerPlans.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(healthOrganizerPlans.id, plan.id), eq(healthOrganizerPlans.version, version), isNull(healthOrganizerPlans.archivedAt)))
        .returning();
      if (!updated) {
        const [current] = await db.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, plan.id)).limit(1);
        return c.json({ error: "version_conflict", ...(current ? { plan: await viewOf(auth, current) } : {}) }, 409);
      }

      if (compartments) {
        const keep = new Set(compartments.filter((x) => x.id).map((x) => x.id!.toLowerCase()));
        const removed = existingCompartments.filter((x) => !keep.has(x.id)).map((x) => x.id);
        // Their time-map rows go with them (foreign key cascade).
        if (removed.length > 0) await db.delete(healthOrganizerCompartments).where(inArray(healthOrganizerCompartments.id, removed));
        // Positions are unique per plan, so a reorder passes through spare slots (8 to 15, the cap being 8).
        const kept = compartments.map((x, index) => ({ ...x, index })).filter((x) => x.id);
        for (const entry of kept) {
          await db
            .update(healthOrganizerCompartments)
            .set({ position: 8 + entry.index })
            .where(eq(healthOrganizerCompartments.id, entry.id!.toLowerCase()));
        }
        for (const entry of kept) {
          await db
            .update(healthOrganizerCompartments)
            .set({ name: entry.name, position: entry.index })
            .where(eq(healthOrganizerCompartments.id, entry.id!.toLowerCase()));
        }
        const added = compartments.map((x, index) => ({ ...x, index })).filter((x) => !x.id);
        if (added.length > 0) {
          await db.insert(healthOrganizerCompartments).values(added.map((x) => ({ planId: plan.id, name: x.name, position: x.index })));
        }
      }

      if (timeMap) {
        await db.delete(healthOrganizerTimeMap).where(eq(healthOrganizerTimeMap.planId, plan.id));
        if (timeMap.size > 0) {
          await db.insert(healthOrganizerTimeMap).values([...timeMap].map(([doseTime, compartmentId]) => ({ planId: plan.id, doseTime, compartmentId })));
        }
      }
      if (assignment) {
        await db
          .insert(healthOrganizerTimeMap)
          .values(groupTimes.map((doseTime) => ({ planId: plan.id, doseTime, compartmentId: assignment.compartmentId })))
          .onConflictDoUpdate({
            target: [healthOrganizerTimeMap.planId, healthOrganizerTimeMap.doseTime],
            set: { compartmentId: assignment.compartmentId },
          });
      }

      if (caregivers) {
        await db.delete(healthOrganizerPlanCaregivers).where(eq(healthOrganizerPlanCaregivers.planId, plan.id));
        if (caregivers.length > 0) {
          await db.insert(healthOrganizerPlanCaregivers).values(caregivers.map((memberId) => ({ planId: plan.id, memberId })));
        }
      }
      return c.json({ plan: await viewOf(auth, updated) });
    } catch (e) {
      if (e instanceof CaregiverAccessError) return c.json({ error: "caregiver_no_access" }, 400);
      const resp = failure(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  // Archive, never delete: sessions and the supply they produced keep their history. Archiving twice is fine.
  app.delete("/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "plan_not_found" }, 404);
    const [plan] = await db.select().from(healthOrganizerPlans).where(eq(healthOrganizerPlans.id, id)).limit(1);
    if (!plan || plan.householdId !== auth.householdId) return c.json({ error: "plan_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, plan.memberId, "medications", "write"))) return c.json({ error: "forbidden" }, 403);
    if (plan.archivedAt) return c.json({ archived: true });

    const [open] = await db
      .select({ id: healthOrganizerSessions.id })
      .from(healthOrganizerSessions)
      .where(and(eq(healthOrganizerSessions.planId, plan.id), eq(healthOrganizerSessions.status, "open")))
      .limit(1);
    if (open) return c.json({ error: "open_session" }, 409);

    await db
      .update(healthOrganizerPlans)
      .set({ archivedAt: new Date(), version: sql`${healthOrganizerPlans.version} + 1`, updatedAt: new Date() })
      .where(and(eq(healthOrganizerPlans.id, plan.id), isNull(healthOrganizerPlans.archivedAt)));
    return c.json({ archived: true });
  });

  return app;
}
