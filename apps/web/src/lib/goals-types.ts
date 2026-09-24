export type GoalVisibility = "household" | "private";

export type RedemptionStatus = "pending" | "approved" | "denied";

export type MilestoneDto = {
  id: string;
  sortOrder: number;
  threshold: number;
  title: string;
  rewardId: string | null;
  achievedAt: string | null;
  claimable: boolean;
  redemptionStatus: RedemptionStatus | null;
};

export type GoalDto = {
  id: string;
  title: string;
  description: string | null;
  unit?: string | null;
  targetDate?: string | null;
  visibility: GoalVisibility;
  ownerMemberId: string;
  totalProgress: number;
  completed: boolean;
  completedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  milestones: MilestoneDto[];
};

/** "12 / 20 books", with a target date when set: "12 / 20 books · Target Oct 31". */
export function goalProgressLabel(
  goal: Pick<GoalDto, "totalProgress" | "unit" | "targetDate">,
  finalThreshold: number,
  now: Date = new Date(),
): string {
  const unit = goal.unit?.trim();
  const base = `${goal.totalProgress} / ${finalThreshold}${unit ? ` ${unit}` : ""}`;
  if (!goal.targetDate) return base;
  const [y, m, d] = goal.targetDate.split("-").map(Number);
  const target = new Date(y!, m! - 1, d!);
  const label = target.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(target.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
  });
  return `${base} · Target ${label}`;
}

export type RewardDto = {
  id: string;
  title: string;
  description: string | null;
  archived: boolean;
  createdAt: string;
};

export type RedemptionDto = {
  id: string;
  milestoneId: string;
  goalId: string;
  rewardId: string;
  memberId: string;
  status: RedemptionStatus;
  claimedByUserId: string | null;
  claimedAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  goalTitle: string;
  rewardTitle: string;
};

export type ProgressEventDto = {
  id: string;
  amount: number;
  note: string | null;
  sourceType: "manual" | "chores" | "health" | "school";
  loggedAt: string;
  createdByUserId: string | null;
};
