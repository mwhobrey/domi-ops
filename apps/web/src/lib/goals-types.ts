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
