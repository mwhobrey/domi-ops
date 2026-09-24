import type { Database } from "@domi-ops/db";
import { goalRewardRedemptions, goalRewards, goals } from "@domi-ops/db";
import { listHouseholdMembersWithAuth, memberShownLabel } from "@domi-ops/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { goalVisibleWhere } from "./goals-access.js";
import { recomputeGoalsProgressBatch } from "./goals.js";

export type GoalsReportData = {
  goals: {
    title: string;
    owner: string;
    progress: number;
    finalThreshold: number | null;
    unit: string | null;
    targetDate: string | null;
    milestonesAchieved: number;
    milestonesTotal: number;
    completedAt: string | null;
  }[];
  redemptions: {
    goalTitle: string;
    rewardTitle: string;
    member: string;
    status: "pending" | "approved" | "denied";
    claimedAt: string;
  }[];
};

/** Every goal the viewer can see, with progress, plus the reward claims on those goals. */
export async function buildGoalsReport(
  db: Database,
  auth: { householdId: string; memberId: string; role: string },
): Promise<GoalsReportData> {
  const roster = await listHouseholdMembersWithAuth(db, auth.householdId);
  const labels = new Map(
    roster.map((m) => [m.memberId, memberShownLabel({ name: m.name }) || m.username || m.email || "Member"]),
  );

  const rows = await db
    .select()
    .from(goals)
    .where(goalVisibleWhere(auth))
    .orderBy(desc(goals.createdAt))
    .limit(200);
  const dtos = await recomputeGoalsProgressBatch(db, rows);

  const redemptionRows =
    rows.length > 0
      ? await db
          .select({
            redemption: goalRewardRedemptions,
            goalTitle: goals.title,
            rewardTitle: goalRewards.title,
          })
          .from(goalRewardRedemptions)
          .innerJoin(goals, eq(goals.id, goalRewardRedemptions.goalId))
          .innerJoin(goalRewards, eq(goalRewards.id, goalRewardRedemptions.rewardId))
          .where(
            and(
              eq(goals.householdId, auth.householdId),
              inArray(
                goalRewardRedemptions.goalId,
                rows.map((r) => r.id),
              ),
            ),
          )
          .orderBy(desc(goalRewardRedemptions.claimedAt))
      : [];

  return {
    goals: dtos.map((g) => {
      const last = g.milestones[g.milestones.length - 1];
      return {
        title: g.title,
        owner: labels.get(g.ownerMemberId) ?? "Member",
        progress: g.totalProgress,
        finalThreshold: last?.threshold ?? null,
        unit: g.unit,
        targetDate: g.targetDate,
        milestonesAchieved: g.milestones.filter((m) => m.achievedAt !== null).length,
        milestonesTotal: g.milestones.length,
        completedAt: g.completedAt,
      };
    }),
    redemptions: redemptionRows.map((r) => ({
      goalTitle: r.goalTitle,
      rewardTitle: r.rewardTitle,
      member: labels.get(r.redemption.memberId) ?? "Member",
      status: r.redemption.status,
      claimedAt: r.redemption.claimedAt.toISOString(),
    })),
  };
}
