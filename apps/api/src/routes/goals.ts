import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  goalMilestones,
  goalProgressEvents,
  goalRewardRedemptions,
  goalRewards,
  goals,
} from "@domi-ops/db";
import { canProvisionMembers } from "@domi-ops/auth";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AppVariables, AuthContext } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { canManageGoal, goalVisibleWhere } from "../lib/goals-access.js";
import {
  GoalValidationError,
  loadAchievedMilestones,
  recomputeGoalProgress,
  recomputeGoalsProgressBatch,
  serializeRedemption,
  serializeReward,
  validateMilestonesPayload,
  type MilestoneInput,
} from "../lib/goals.js";
import { buildGoalsGlance, type GoalGlanceRow } from "../lib/goals-glance.js";

async function loadGoalRow(db: Database, id: string) {
  const [row] = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return row ?? null;
}

/** Loads a goal only if it's visible to `auth` (household/private + owner/admin override). */
async function loadVisibleGoal(db: Database, auth: AuthContext, id: string) {
  const row = await loadGoalRow(db, id);
  if (!row || row.householdId !== auth.householdId) return null;
  if (row.visibility === "household") return row;
  if (row.ownerMemberId === auth.memberId) return row;
  if (canProvisionMembers(auth.role)) return row;
  return null;
}

export function goalsRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "goals"));

  // Static-path routes (glance/redemptions/rewards) are registered before the `/:id`-shaped
  // goal routes below — Hono matches routes in registration order for same-shape paths, so a
  // `/:id` handler registered first would otherwise swallow e.g. `GET /rewards` (id="rewards").

  app.get("/glance", async (c) => {
    const auth = c.get("auth")!;
    const isApprover = canProvisionMembers(auth.role);

    const goalRows = await db
      .select()
      .from(goals)
      .where(and(goalVisibleWhere(auth), isNull(goals.completedAt)))
      .orderBy(desc(goals.createdAt))
      .limit(25);

    const goalIds = goalRows.map((g) => g.id);
    const milestoneRows =
      goalIds.length > 0
        ? await db
            .select()
            .from(goalMilestones)
            .where(inArray(goalMilestones.goalId, goalIds))
            .orderBy(asc(goalMilestones.sortOrder))
        : [];
    const milestoneIds = milestoneRows.map((m) => m.id);
    const redemptionMilestoneIds =
      milestoneIds.length > 0
        ? new Set(
            (
              await db
                .select({ milestoneId: goalRewardRedemptions.milestoneId })
                .from(goalRewardRedemptions)
                .where(inArray(goalRewardRedemptions.milestoneId, milestoneIds))
            ).map((r) => r.milestoneId),
          )
        : new Set<string>();

    const milestonesByGoal = new Map<string, typeof milestoneRows>();
    for (const m of milestoneRows) {
      const list = milestonesByGoal.get(m.goalId) ?? [];
      list.push(m);
      milestonesByGoal.set(m.goalId, list);
    }

    const rows: GoalGlanceRow[] = goalRows.map((g) => {
      const milestones = milestonesByGoal.get(g.id) ?? [];
      const claimableCount = milestones.filter(
        (m) => m.achievedAt !== null && m.rewardId !== null && !redemptionMilestoneIds.has(m.id),
      ).length;
      const nextMilestone = milestones.find((m) => m.achievedAt === null);
      return {
        id: g.id,
        title: g.title,
        completed: false,
        claimableCount,
        nextMilestoneTitle: nextMilestone?.title ?? null,
      };
    });

    let pendingApprovalsCount = 0;
    if (isApprover) {
      const pending = await db
        .select({ id: goalRewardRedemptions.id })
        .from(goalRewardRedemptions)
        .innerJoin(goals, eq(goals.id, goalRewardRedemptions.goalId))
        .where(and(eq(goals.householdId, auth.householdId), eq(goalRewardRedemptions.status, "pending")));
      pendingApprovalsCount = pending.length;
    }

    return c.json(buildGoalsGlance(rows, pendingApprovalsCount, isApprover));
  });

  app.get("/redemptions", async (c) => {
    const auth = c.get("auth")!;
    const status = c.req.query("status");
    const isApprover = canProvisionMembers(auth.role);
    const conditions = [eq(goals.householdId, auth.householdId)];
    if (!isApprover) conditions.push(eq(goalRewardRedemptions.memberId, auth.memberId));
    if (status === "pending" || status === "approved" || status === "denied") {
      conditions.push(eq(goalRewardRedemptions.status, status));
    }
    const rows = await db
      .select({
        redemption: goalRewardRedemptions,
        goalTitle: goals.title,
        rewardTitle: goalRewards.title,
      })
      .from(goalRewardRedemptions)
      .innerJoin(goals, eq(goals.id, goalRewardRedemptions.goalId))
      .innerJoin(goalRewards, eq(goalRewards.id, goalRewardRedemptions.rewardId))
      .where(and(...conditions))
      .orderBy(desc(goalRewardRedemptions.claimedAt))
      .limit(100);
    return c.json({
      redemptions: rows.map((r) => ({
        ...serializeRedemption(r.redemption),
        goalTitle: r.goalTitle,
        rewardTitle: r.rewardTitle,
      })),
    });
  });

  app.patch("/redemptions/:id", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) return c.json({ error: "forbidden" }, 403);
    const id = c.req.param("id");
    const body = await c.req.json<{ decision?: "approved" | "denied"; decisionNote?: string }>();
    if (body.decision !== "approved" && body.decision !== "denied") {
      return c.json({ error: "decision_required" }, 400);
    }
    const [row] = await db
      .select({ redemption: goalRewardRedemptions })
      .from(goalRewardRedemptions)
      .innerJoin(goals, eq(goals.id, goalRewardRedemptions.goalId))
      .where(and(eq(goalRewardRedemptions.id, id), eq(goals.householdId, auth.householdId)))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.redemption.status !== "pending") return c.json({ error: "already_decided" }, 409);
    const [updated] = await db
      .update(goalRewardRedemptions)
      .set({
        status: body.decision,
        decidedByUserId: auth.userId,
        decidedAt: new Date(),
        decisionNote: body.decisionNote?.trim() || null,
      })
      .where(eq(goalRewardRedemptions.id, id))
      .returning();
    return c.json({ redemption: serializeRedemption(updated) });
  });

  app.get("/rewards", async (c) => {
    const auth = c.get("auth")!;
    const includeArchived = c.req.query("includeArchived") === "1" && canProvisionMembers(auth.role);
    const conditions = [eq(goalRewards.householdId, auth.householdId)];
    if (!includeArchived) conditions.push(isNull(goalRewards.archivedAt));
    const rows = await db
      .select()
      .from(goalRewards)
      .where(and(...conditions))
      .orderBy(asc(goalRewards.title))
      .limit(200);
    return c.json({ rewards: rows.map(serializeReward) });
  });

  app.post("/rewards", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{ title?: string; description?: string }>();
    const title = body.title?.trim();
    if (!title) return c.json({ error: "title_required" }, 400);
    const [row] = await db
      .insert(goalRewards)
      .values({
        householdId: auth.householdId,
        title,
        description: body.description?.trim() || null,
        createdByUserId: auth.userId,
      })
      .returning();
    return c.json({ reward: serializeReward(row) }, 201);
  });

  app.patch("/rewards/:id", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) return c.json({ error: "forbidden" }, 403);
    const id = c.req.param("id");
    const body = await c.req.json<{ title?: string; description?: string; archived?: boolean }>();
    const patch: Partial<typeof goalRewards.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) return c.json({ error: "title_required" }, 400);
      patch.title = title;
    }
    if (body.description !== undefined) patch.description = body.description?.trim() || null;
    if (body.archived !== undefined) patch.archivedAt = body.archived ? new Date() : null;
    const [row] = await db
      .update(goalRewards)
      .set(patch)
      .where(and(eq(goalRewards.id, id), eq(goalRewards.householdId, auth.householdId)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ reward: serializeReward(row) });
  });

  app.delete("/rewards/:id", async (c) => {
    const auth = c.get("auth")!;
    if (!canProvisionMembers(auth.role)) return c.json({ error: "forbidden" }, 403);
    const id = c.req.param("id");
    const [inUse] = await db
      .select({ id: goalRewardRedemptions.id })
      .from(goalRewardRedemptions)
      .where(eq(goalRewardRedemptions.rewardId, id))
      .limit(1);
    if (inUse) return c.json({ error: "reward_in_use" }, 409);
    const [deleted] = await db
      .delete(goalRewards)
      .where(and(eq(goalRewards.id, id), eq(goalRewards.householdId, auth.householdId)))
      .returning({ id: goalRewards.id });
    if (!deleted) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const ownerMemberId = c.req.query("ownerMemberId");
    const conditions = [goalVisibleWhere(auth)];
    if (ownerMemberId) conditions.push(eq(goals.ownerMemberId, ownerMemberId));
    const rows = await db
      .select()
      .from(goals)
      .where(and(...conditions))
      .orderBy(desc(goals.createdAt))
      .limit(100);
    const dtos = await recomputeGoalsProgressBatch(db, rows);
    return c.json({ goals: dtos });
  });

  app.post("/", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title?: string;
      description?: string;
      visibility?: "household" | "private";
      ownerMemberId?: string;
      milestones?: MilestoneInput[];
    }>();

    const title = body.title?.trim();
    if (!title) return c.json({ error: "title_required" }, 400);

    const ownerMemberId = body.ownerMemberId || auth.memberId;
    if (ownerMemberId !== auth.memberId && !canProvisionMembers(auth.role)) {
      return c.json({ error: "forbidden" }, 403);
    }

    let normalizedMilestones;
    try {
      normalizedMilestones = await validateMilestonesPayload(
        db,
        auth.householdId,
        body.milestones ?? [],
      );
    } catch (err) {
      if (err instanceof GoalValidationError) return c.json({ error: err.code, message: err.message }, 400);
      throw err;
    }

    const visibility = body.visibility === "private" ? "private" : "household";

    const [goalRow] = await db
      .insert(goals)
      .values({
        householdId: auth.householdId,
        ownerMemberId,
        title,
        description: body.description?.trim() || null,
        visibility,
        createdByUserId: auth.userId,
      })
      .returning();

    await db.insert(goalMilestones).values(
      normalizedMilestones.map((m, i) => ({
        goalId: goalRow.id,
        sortOrder: i,
        threshold: m.threshold,
        title: m.title,
        rewardId: m.rewardId,
      })),
    );

    const dto = await recomputeGoalProgress(db, goalRow.id);
    return c.json({ goal: dto }, 201);
  });

  app.get("/:id", async (c) => {
    const auth = c.get("auth")!;
    const row = await loadVisibleGoal(db, auth, c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const dto = await recomputeGoalProgress(db, row.id);
    return c.json({ goal: dto });
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const row = await loadGoalRow(db, id);
    if (!row || row.householdId !== auth.householdId) return c.json({ error: "not_found" }, 404);
    if (!canManageGoal(auth.role, row.ownerMemberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{
      title?: string;
      description?: string;
      visibility?: "household" | "private";
    }>();
    const patch: Partial<typeof goals.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) return c.json({ error: "title_required" }, 400);
      patch.title = title;
    }
    // description is sent as null (not omitted) when the editor's field is blank — same "clear it"
    // convention as GoalEditSheet's `description.trim() || null`, so a plain .trim() here would
    // throw on null.
    if (body.description !== undefined) patch.description = body.description?.trim() || null;
    if (body.visibility !== undefined) {
      patch.visibility = body.visibility === "private" ? "private" : "household";
    }
    await db.update(goals).set(patch).where(eq(goals.id, id));
    const dto = await recomputeGoalProgress(db, id);
    return c.json({ goal: dto });
  });

  app.patch("/:id/milestones", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const row = await loadGoalRow(db, id);
    if (!row || row.householdId !== auth.householdId) return c.json({ error: "not_found" }, 404);
    if (!canManageGoal(auth.role, row.ownerMemberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{ milestones?: MilestoneInput[] }>();
    const incoming = body.milestones ?? [];

    const achieved = await loadAchievedMilestones(db, id);
    if (incoming.length < achieved.length) {
      return c.json(
        { error: "achieved_milestone_locked", message: "Achieved milestones can't be removed" },
        400,
      );
    }
    for (let i = 0; i < achieved.length; i++) {
      const existing = achieved[i];
      const sent = incoming[i];
      if (
        sent?.id !== existing.id ||
        sent.threshold !== existing.threshold ||
        sent.title?.trim() !== existing.title ||
        (sent.rewardId || null) !== existing.rewardId
      ) {
        return c.json(
          {
            error: "achieved_milestone_locked",
            message: "Achieved milestones are immutable and must be resent unchanged, in order",
          },
          400,
        );
      }
    }

    const pendingInputs = incoming.slice(achieved.length);
    const minThreshold = achieved.length > 0 ? achieved[achieved.length - 1].threshold : -Infinity;
    // A goal whose milestones are ALL achieved resends nothing beyond the achieved prefix — that's
    // valid (nothing left to edit), not "no milestones at all". Only require at least one pending
    // milestone via validateMilestonesPayload's "milestones_required" when there's no achieved
    // prefix either, matching the create-goal requirement of at least one milestone overall.
    let normalizedPending: { title: string; threshold: number; rewardId: string | null }[] = [];
    if (pendingInputs.length > 0) {
      try {
        normalizedPending = await validateMilestonesPayload(
          db,
          auth.householdId,
          pendingInputs,
          minThreshold,
        );
      } catch (err) {
        if (err instanceof GoalValidationError) return c.json({ error: err.code, message: err.message }, 400);
        throw err;
      }
    } else if (achieved.length === 0) {
      return c.json({ error: "milestones_required", message: "At least one milestone is required" }, 400);
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(goalMilestones)
        .where(and(eq(goalMilestones.goalId, id), isNull(goalMilestones.achievedAt)));
      if (normalizedPending.length > 0) {
        await tx.insert(goalMilestones).values(
          normalizedPending.map((m, i) => ({
            goalId: id,
            sortOrder: achieved.length + i,
            threshold: m.threshold,
            title: m.title,
            rewardId: m.rewardId,
          })),
        );
      }
    });

    const dto = await recomputeGoalProgress(db, id);
    return c.json({ goal: dto });
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const row = await loadGoalRow(db, id);
    if (!row || row.householdId !== auth.householdId) return c.json({ error: "not_found" }, 404);
    if (!canManageGoal(auth.role, row.ownerMemberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await db.delete(goals).where(eq(goals.id, id));
    return c.json({ ok: true });
  });

  app.post("/:id/progress", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const row = await loadGoalRow(db, id);
    if (!row || row.householdId !== auth.householdId) return c.json({ error: "not_found" }, 404);
    if (!canManageGoal(auth.role, row.ownerMemberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{ amount?: number; note?: string }>();
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return c.json({ error: "amount_required", message: "amount must be a non-zero number" }, 400);
    }
    await db.insert(goalProgressEvents).values({
      goalId: id,
      householdId: auth.householdId,
      sourceType: "manual",
      amount,
      note: body.note?.trim() || null,
      createdByUserId: auth.userId,
    });
    const dto = await recomputeGoalProgress(db, id);
    return c.json({ goal: dto }, 201);
  });

  app.delete("/:id/progress/:eventId", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const eventId = c.req.param("eventId");
    const row = await loadGoalRow(db, id);
    if (!row || row.householdId !== auth.householdId) return c.json({ error: "not_found" }, 404);
    if (!canManageGoal(auth.role, row.ownerMemberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [deleted] = await db
      .delete(goalProgressEvents)
      .where(and(eq(goalProgressEvents.id, eventId), eq(goalProgressEvents.goalId, id)))
      .returning({ id: goalProgressEvents.id });
    if (!deleted) return c.json({ error: "not_found" }, 404);
    const dto = await recomputeGoalProgress(db, id);
    return c.json({ goal: dto });
  });

  app.get("/:id/progress", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const row = await loadVisibleGoal(db, auth, id);
    if (!row) return c.json({ error: "not_found" }, 404);
    const events = await db
      .select()
      .from(goalProgressEvents)
      .where(eq(goalProgressEvents.goalId, id))
      .orderBy(desc(goalProgressEvents.loggedAt))
      .limit(100);
    return c.json({
      events: events.map((e) => ({
        id: e.id,
        amount: e.amount,
        note: e.note,
        sourceType: e.sourceType,
        loggedAt: e.loggedAt.toISOString(),
        createdByUserId: e.createdByUserId,
      })),
    });
  });

  app.post("/:goalId/milestones/:milestoneId/claim", async (c) => {
    const auth = c.get("auth")!;
    const goalId = c.req.param("goalId");
    const milestoneId = c.req.param("milestoneId");
    const goalRow = await loadGoalRow(db, goalId);
    if (!goalRow || goalRow.householdId !== auth.householdId) return c.json({ error: "not_found" }, 404);
    if (!canManageGoal(auth.role, goalRow.ownerMemberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [milestone] = await db
      .select()
      .from(goalMilestones)
      .where(and(eq(goalMilestones.id, milestoneId), eq(goalMilestones.goalId, goalId)))
      .limit(1);
    if (!milestone) return c.json({ error: "not_found" }, 404);
    if (!milestone.achievedAt) return c.json({ error: "not_achieved" }, 409);
    if (!milestone.rewardId) return c.json({ error: "no_reward" }, 409);

    // onConflictDoNothing against the unique milestone_id index is the real guard — it makes this
    // race-safe against two concurrent claims on the same milestone (a plain SELECT-then-INSERT
    // would let both requests pass the check and one insert would 500 on the constraint). A no-op
    // insert returns no row, which reads the same as "someone already claimed it".
    const [redemption] = await db
      .insert(goalRewardRedemptions)
      .values({
        milestoneId,
        goalId,
        rewardId: milestone.rewardId,
        memberId: goalRow.ownerMemberId,
        status: "pending",
        claimedByUserId: auth.userId,
      })
      .onConflictDoNothing({ target: goalRewardRedemptions.milestoneId })
      .returning();
    if (!redemption) return c.json({ error: "already_claimed" }, 409);
    return c.json({ redemption: serializeRedemption(redemption) }, 201);
  });

  return app;
}
