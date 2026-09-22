export type GoalGlanceRow = {
  id: string;
  title: string;
  completed: boolean;
  claimableCount: number;
  nextMilestoneTitle: string | null;
};

export type GoalGlanceTone = "success" | "warning" | "default";

/** Same summary/items/overflow shape as buildChoresGlance — claimable rewards and (for
 *  owner/admin) pending approvals are the actionable bits, everything else is just "in progress". */
export function buildGoalsGlance(
  rows: GoalGlanceRow[],
  pendingApprovalsCount: number,
  isApprover: boolean,
) {
  const open = rows.filter((r) => !r.completed);
  // Filter from `open`, not `rows` — a completed goal can still carry a claimable-but-unclaimed
  // reward on one of its milestones, and that shouldn't count toward the actionable headline or
  // push a "done" goal back into the items list.
  const claimable = open.filter((r) => r.claimableCount > 0);
  const totalClaimable = claimable.reduce((sum, r) => sum + r.claimableCount, 0);

  const ordered = [
    ...claimable,
    ...open.filter((r) => r.claimableCount === 0),
  ];
  const previewLimit = 4;
  const items = ordered.slice(0, previewLimit).map((r) => ({
    id: r.id,
    title: r.title,
    meta:
      r.claimableCount > 0
        ? `${r.claimableCount} reward${r.claimableCount === 1 ? "" : "s"} to claim`
        : r.nextMilestoneTitle
          ? `Next: ${r.nextMilestoneTitle}`
          : undefined,
  }));
  const overflow = Math.max(0, ordered.length - previewLimit);

  let headline: string;
  let tone: GoalGlanceTone = "default";
  if (isApprover && pendingApprovalsCount > 0) {
    headline = `${pendingApprovalsCount} to approve`;
    tone = "warning";
  } else if (totalClaimable > 0) {
    headline = `${totalClaimable} to claim`;
    tone = "warning";
  } else if (open.length === 0) {
    headline = "All caught up";
    tone = "success";
  } else {
    headline = `${open.length} in progress`;
  }

  return {
    summary: { headline, tone },
    items,
    overflow,
  };
}
