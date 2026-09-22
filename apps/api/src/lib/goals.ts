import type { Database } from "@domi-ops/db";
import {
  goalMilestones,
  goalProgressEvents,
  goalRewardRedemptions,
  goalRewards,
  goals,
} from "@domi-ops/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

export const MAX_MILESTONES_PER_GOAL = 20;

type GoalRow = typeof goals.$inferSelect;
type MilestoneRow = typeof goalMilestones.$inferSelect;
type RewardRow = typeof goalRewards.$inferSelect;
type RedemptionRow = typeof goalRewardRedemptions.$inferSelect;

export type MilestoneInput = {
  id?: string;
  threshold: number;
  title: string;
  rewardId?: string | null;
};

export class GoalValidationError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "GoalValidationError";
    this.code = code;
  }
}

/**
 * Pure shape validation for a milestone list: strictly ascending thresholds (each one greater
 * than the previous, and greater than `minThreshold` — the last already-achieved threshold, or
 * -Infinity for a brand-new goal), non-empty titles, a sane count. No DB access, so this is the
 * unit-testable core of milestone validation (goals.test.ts). Reward existence/archive-state is
 * checked separately by the DB-touching wrapper below.
 */
export function validateMilestoneShapes(
  milestones: MilestoneInput[],
  minThreshold: number = -Infinity,
): { title: string; threshold: number; rewardId: string | null }[] {
  if (milestones.length === 0) {
    throw new GoalValidationError("At least one milestone is required", "milestones_required");
  }
  if (milestones.length > MAX_MILESTONES_PER_GOAL) {
    throw new GoalValidationError(
      `A goal can have at most ${MAX_MILESTONES_PER_GOAL} milestones`,
      "too_many_milestones",
    );
  }
  let previous = minThreshold;
  const normalized: { title: string; threshold: number; rewardId: string | null }[] = [];
  for (const m of milestones) {
    const title = m.title?.trim();
    if (!title) {
      throw new GoalValidationError("Every milestone needs a title", "milestone_title_required");
    }
    if (!Number.isFinite(m.threshold)) {
      throw new GoalValidationError("Milestone threshold must be a number", "invalid_threshold");
    }
    if (m.threshold <= previous) {
      throw new GoalValidationError(
        "Milestone thresholds must strictly increase",
        "thresholds_not_ascending",
      );
    }
    previous = m.threshold;
    normalized.push({ title, threshold: m.threshold, rewardId: m.rewardId || null });
  }
  return normalized;
}

/**
 * Full validation including DB-backed reward checks (exists, belongs to household, not archived).
 */
export async function validateMilestonesPayload(
  db: Database,
  householdId: string,
  milestones: MilestoneInput[],
  minThreshold: number = -Infinity,
): Promise<{ title: string; threshold: number; rewardId: string | null }[]> {
  const normalized = validateMilestoneShapes(milestones, minThreshold);
  const rewardIds = [...new Set(normalized.map((m) => m.rewardId).filter((id): id is string => !!id))];
  if (rewardIds.length > 0) {
    const rows = await db
      .select({ id: goalRewards.id, archivedAt: goalRewards.archivedAt })
      .from(goalRewards)
      .where(and(eq(goalRewards.householdId, householdId), inArray(goalRewards.id, rewardIds)));
    const validIds = new Set(rows.filter((r) => !r.archivedAt).map((r) => r.id));
    for (const id of rewardIds) {
      if (!validIds.has(id)) {
        throw new GoalValidationError(
          "One or more linked rewards are invalid or archived",
          "invalid_reward",
        );
      }
    }
  }
  return normalized;
}

/**
 * Pure math: given a goal's milestones (ascending by threshold, already-achieved ones carry a
 * non-null achievedAt) and a running total, returns the ids of milestones that should newly
 * become achieved. Already-achieved milestones are never returned (ratchet — a later negative
 * correction that drops `total` back below threshold must not un-achieve them).
 */
export function milestonesCrossedByTotal(
  milestones: { id: string; threshold: number; achievedAt: Date | null }[],
  total: number,
): string[] {
  return milestones.filter((m) => m.achievedAt === null && total >= m.threshold).map((m) => m.id);
}

export type GoalDto = {
  id: string;
  title: string;
  description: string | null;
  visibility: "household" | "private";
  ownerMemberId: string;
  totalProgress: number;
  completed: boolean;
  completedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  milestones: MilestoneDto[];
};

export type MilestoneDto = {
  id: string;
  sortOrder: number;
  threshold: number;
  title: string;
  rewardId: string | null;
  achievedAt: string | null;
  claimable: boolean;
  redemptionStatus: "pending" | "approved" | "denied" | null;
};

export function serializeMilestone(
  row: MilestoneRow,
  hasRedemption: boolean,
  redemptionStatus: RedemptionRow["status"] | null,
): MilestoneDto {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    threshold: row.threshold,
    title: row.title,
    rewardId: row.rewardId,
    achievedAt: row.achievedAt ? row.achievedAt.toISOString() : null,
    claimable: row.achievedAt !== null && row.rewardId !== null && !hasRedemption,
    redemptionStatus,
  };
}

export function serializeReward(row: RewardRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeRedemption(row: RedemptionRow) {
  return {
    id: row.id,
    milestoneId: row.milestoneId,
    goalId: row.goalId,
    rewardId: row.rewardId,
    memberId: row.memberId,
    status: row.status,
    claimedByUserId: row.claimedByUserId,
    claimedAt: row.claimedAt.toISOString(),
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionNote: row.decisionNote,
  };
}

async function loadMilestonesWithRedemptions(
  db: Database,
  goalId: string,
): Promise<{ rows: MilestoneRow[]; dtos: MilestoneDto[] }> {
  const rows = await db
    .select()
    .from(goalMilestones)
    .where(eq(goalMilestones.goalId, goalId))
    .orderBy(asc(goalMilestones.sortOrder));
  const milestoneIds = rows.map((r) => r.id);
  const redemptions =
    milestoneIds.length > 0
      ? await db
          .select()
          .from(goalRewardRedemptions)
          .where(inArray(goalRewardRedemptions.milestoneId, milestoneIds))
      : [];
  const redemptionByMilestone = new Map(redemptions.map((r) => [r.milestoneId, r]));
  const dtos = rows.map((row) => {
    const redemption = redemptionByMilestone.get(row.id);
    return serializeMilestone(row, redemption !== undefined, redemption?.status ?? null);
  });
  return { rows, dtos };
}

function serializeGoal(row: GoalRow, milestoneDtos: MilestoneDto[]): GoalDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    ownerMemberId: row.ownerMemberId,
    totalProgress: 0, // overwritten by recomputeGoalProgress's caller once the sum is known
    completed: row.completedAt !== null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    milestones: milestoneDtos,
  };
}

/**
 * The one shared helper called from every route that reads or mutates a goal. Sums progress
 * events, ratchets milestone `achievedAt` / goal `completedAt` forward as needed, and returns
 * the fully hydrated DTO. Read-only when nothing has newly crossed (no wasted UPDATE).
 */
export async function recomputeGoalProgress(db: Database, goalId: string): Promise<GoalDto | null> {
  const [goalRow] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!goalRow) return null;

  const [{ total }] = await db
    .select({ total: sql<number>`coalesce(sum(${goalProgressEvents.amount}), 0)` })
    .from(goalProgressEvents)
    .where(eq(goalProgressEvents.goalId, goalId));
  const totalProgress = Number(total);

  let { rows: milestoneRows } = await loadMilestonesWithRedemptions(db, goalId);
  const crossedIds = milestonesCrossedByTotal(milestoneRows, totalProgress);

  let completedAt = goalRow.completedAt;
  if (crossedIds.length > 0) {
    await db
      .update(goalMilestones)
      .set({ achievedAt: new Date() })
      .where(and(eq(goalMilestones.goalId, goalId), inArray(goalMilestones.id, crossedIds)));
    ({ rows: milestoneRows } = await loadMilestonesWithRedemptions(db, goalId));
  }

  const lastMilestone = milestoneRows[milestoneRows.length - 1];
  if (lastMilestone?.achievedAt && !completedAt) {
    const [updated] = await db
      .update(goals)
      .set({ completedAt: new Date() })
      .where(eq(goals.id, goalId))
      .returning({ completedAt: goals.completedAt });
    completedAt = updated.completedAt;
  }

  const { dtos: milestoneDtos } = await loadMilestonesWithRedemptions(db, goalId);
  const dto = serializeGoal({ ...goalRow, completedAt }, milestoneDtos);
  dto.totalProgress = totalProgress;
  dto.completed = completedAt !== null;
  dto.completedAt = completedAt ? completedAt.toISOString() : null;
  return dto;
}

/** Not-yet-achieved milestones for a goal, ordered — used by the milestone-replace endpoint. */
export async function loadPendingMilestones(db: Database, goalId: string): Promise<MilestoneRow[]> {
  return db
    .select()
    .from(goalMilestones)
    .where(and(eq(goalMilestones.goalId, goalId), isNull(goalMilestones.achievedAt)))
    .orderBy(asc(goalMilestones.sortOrder));
}

export async function loadAchievedMilestones(db: Database, goalId: string): Promise<MilestoneRow[]> {
  return db
    .select()
    .from(goalMilestones)
    .where(and(eq(goalMilestones.goalId, goalId), sql`${goalMilestones.achievedAt} is not null`))
    .orderBy(asc(goalMilestones.sortOrder));
}
