"use client";

import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { ApiError, apiClient } from "../lib/client-api";
import type { GoalDto, RedemptionDto, RewardDto } from "../lib/goals-types";
import type { NoteShareMember } from "./NoteSharePicker";
import { GoalEditSheet } from "./goals/GoalEditSheet";
import { GoalProgressLog } from "./goals/GoalProgressLog";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Input,
  Textarea,
} from "./ui";

function canManageGoalClient(role: string, ownerMemberId: string, memberId?: string): boolean {
  if (role === "owner" || role === "admin") return true;
  return ownerMemberId === memberId;
}

function memberLabel(members: NoteShareMember[], memberId: string): string {
  return members.find((m) => m.memberId === memberId)?.label ?? "Member";
}

function GoalCard({
  goal,
  members,
  role,
  currentMemberId,
  onEdit,
  onDelete,
  onUpdated,
  onClaim,
}: {
  goal: GoalDto;
  members: NoteShareMember[];
  role: string;
  currentMemberId?: string;
  onEdit: () => void;
  onDelete: () => void;
  onUpdated: (goal: GoalDto) => void;
  onClaim: (milestoneId: string) => void;
}) {
  const canManage = canManageGoalClient(role, goal.ownerMemberId, currentMemberId);
  const lastMilestone = goal.milestones[goal.milestones.length - 1];
  // A threshold of 0 or negative is a degenerate case the API's validation floor technically
  // allows for a goal's very first milestone (finite and > -Infinity) — guard it here so the bar
  // never divides by zero/negative and renders NaN% / a negative width.
  const progressPct =
    lastMilestone && lastMilestone.threshold > 0
      ? Math.min(100, Math.max(0, (goal.totalProgress / lastMilestone.threshold) * 100))
      : 0;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-text)]">{goal.title}</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              {memberLabel(members, goal.ownerMemberId)}
            </p>
            {goal.description ? (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{goal.description}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {goal.completed ? <Badge tone="success">Completed</Badge> : null}
            <Badge tone="default">{goal.visibility === "private" ? "Private" : "Household"}</Badge>
          </div>
        </div>

        {lastMilestone ? (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]/50">
              <div
                className="h-full rounded-full bg-[var(--color-accent)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              {goal.totalProgress} / {lastMilestone.threshold}
            </p>
          </div>
        ) : null}

        <ul className="space-y-1">
          {goal.milestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <span className={m.achievedAt ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}>
                {m.achievedAt ? "✓ " : "○ "}
                {m.title} ({m.threshold})
              </span>
              {m.claimable ? (
                <Button type="button" size="sm" onClick={() => onClaim(m.id)}>
                  Claim reward
                </Button>
              ) : m.redemptionStatus ? (
                <Badge tone={m.redemptionStatus === "approved" ? "success" : m.redemptionStatus === "denied" ? "warning" : "accent"}>
                  {m.redemptionStatus}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>

        <GoalProgressLog goal={goal} canManage={canManage} onUpdated={onUpdated} />

        {canManage ? (
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function RewardsTab({
  rewards,
  canManage,
  onChanged,
}: {
  rewards: RewardDto[];
  canManage: boolean;
  onChanged: (rewards: RewardDto[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addReward() {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.post<{ reward: RewardDto }>("/api/goals/rewards", {
        title: title.trim(),
        description: description.trim() || undefined,
      });
      onChanged([...rewards, data.reward]);
      setTitle("");
      setDescription("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add reward");
    } finally {
      setLoading(false);
    }
  }

  async function toggleArchive(reward: RewardDto) {
    try {
      const data = await apiClient.patch<{ reward: RewardDto }>(`/api/goals/rewards/${reward.id}`, {
        archived: !reward.archived,
      });
      onChanged(rewards.map((r) => (r.id === reward.id ? data.reward : r)));
    } catch {
      setError("Could not update reward");
    }
  }

  async function deleteReward(reward: RewardDto) {
    try {
      await apiClient.delete(`/api/goals/rewards/${reward.id}`);
      onChanged(rewards.filter((r) => r.id !== reward.id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.body?.includes("reward_in_use")
          ? "This reward has been claimed before — archive it instead of deleting."
          : "Could not delete reward",
      );
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {canManage ? (
        <Card>
          <CardBody className="space-y-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reward title"
              aria-label="Reward title"
              disabled={loading}
            />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              aria-label="Reward description"
              disabled={loading}
            />
            <Button type="button" size="sm" loading={loading} onClick={() => void addReward()}>
              + Add reward
            </Button>
          </CardBody>
        </Card>
      ) : null}
      {rewards.length === 0 ? (
        <EmptyState title="No rewards yet" description="Add a reward catalog entry above." />
      ) : (
        <ul className="space-y-2">
          {rewards.map((r) => (
            <li key={r.id}>
              <Card>
                <CardBody className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">
                      {r.title} {r.archived ? <Badge tone="default">Archived</Badge> : null}
                    </p>
                    {r.description ? (
                      <p className="text-xs text-[var(--color-text-muted)]">{r.description}</p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => void toggleArchive(r)}>
                        {r.archived ? "Unarchive" : "Archive"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteReward(r)}>
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApprovalsTab({
  redemptions,
  onChanged,
}: {
  redemptions: RedemptionDto[];
  onChanged: (redemptions: RedemptionDto[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function decide(id: string, decision: "approved" | "denied") {
    try {
      const data = await apiClient.patch<{ redemption: RedemptionDto }>(`/api/goals/redemptions/${id}`, {
        decision,
        decisionNote: notes[id]?.trim() || undefined,
      });
      onChanged(redemptions.map((r) => (r.id === id ? data.redemption : r)));
    } catch {
      setError("Could not record decision");
    }
  }

  const pending = redemptions.filter((r) => r.status === "pending");

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {pending.length === 0 ? (
        <EmptyState title="Nothing to approve" description="Claimed rewards will show up here." />
      ) : (
        <ul className="space-y-2">
          {pending.map((r) => (
            <li key={r.id}>
              <Card>
                <CardBody className="space-y-2">
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {r.rewardTitle} — {r.goalTitle}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Claimed {new Date(r.claimedAt).toLocaleString()}
                  </p>
                  <Input
                    placeholder="Note (optional)"
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    aria-label="Decision note"
                  />
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={() => void decide(r.id, "approved")}>
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void decide(r.id, "denied")}
                    >
                      Deny
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GoalsPageClient({
  initialGoals,
  initialRewards,
  members,
  currentMemberId,
  role,
}: {
  initialGoals: GoalDto[];
  initialRewards: RewardDto[];
  members: NoteShareMember[];
  currentMemberId?: string;
  role: string;
}) {
  const [tab, setTab] = useState<"goals" | "rewards" | "approvals">("goals");
  const [goals, setGoals] = useState(initialGoals);
  const [rewards, setRewards] = useState(initialRewards);
  const [redemptions, setRedemptions] = useState<RedemptionDto[]>([]);
  const [editGoal, setEditGoal] = useState<GoalDto | null | "new">(null);
  const [deleteGoalId, setDeleteGoalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isApprover = role === "owner" || role === "admin";

  useEffect(() => {
    if (tab !== "approvals" || !isApprover) return;
    apiClient
      .get<{ redemptions: RedemptionDto[] }>("/api/goals/redemptions")
      .then((data) => setRedemptions(data.redemptions))
      .catch(() => setError("Could not load approvals"));
  }, [tab, isApprover]);

  async function claim(goalId: string, milestoneId: string) {
    try {
      await apiClient.post(`/api/goals/${goalId}/milestones/${milestoneId}/claim`);
      const data = await apiClient.get<{ goal: GoalDto }>(`/api/goals/${goalId}`);
      setGoals((prev) => prev.map((g) => (g.id === goalId ? data.goal : g)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not claim reward");
    }
  }

  async function deleteGoal(id: string) {
    try {
      await apiClient.delete(`/api/goals/${id}`);
      setGoals((prev) => prev.filter((g) => g.id !== id));
    } catch {
      setError("Could not delete goal");
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(["goals", "rewards"] as const).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={tab === key ? "primary" : "secondary"}
              onClick={() => setTab(key)}
            >
              {key === "goals" ? "Goals" : "Rewards"}
            </Button>
          ))}
          {isApprover ? (
            <Button
              size="sm"
              variant={tab === "approvals" ? "primary" : "secondary"}
              onClick={() => setTab("approvals")}
            >
              Approvals
              {redemptions.filter((r) => r.status === "pending").length > 0
                ? ` (${redemptions.filter((r) => r.status === "pending").length})`
                : ""}
            </Button>
          ) : null}
        </div>
        {tab === "goals" ? (
          <Button size="sm" onClick={() => setEditGoal("new")}>
            + New goal
          </Button>
        ) : null}
      </div>

      {tab === "goals" ? (
        goals.length === 0 ? (
          <EmptyState
            title="No goals yet"
            description="Set a goal with a few milestones to get started."
            icon={<Target className="h-10 w-10" />}
          />
        ) : (
          <ul className="space-y-3">
            {goals.map((g) => (
              <li key={g.id}>
                <GoalCard
                  goal={g}
                  members={members}
                  role={role}
                  currentMemberId={currentMemberId}
                  onEdit={() => setEditGoal(g)}
                  onDelete={() => setDeleteGoalId(g.id)}
                  onUpdated={(updated) =>
                    setGoals((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
                  }
                  onClaim={(milestoneId) => void claim(g.id, milestoneId)}
                />
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "rewards" ? (
        <RewardsTab rewards={rewards} canManage={isApprover} onChanged={setRewards} />
      ) : null}

      {tab === "approvals" && isApprover ? (
        <ApprovalsTab redemptions={redemptions} onChanged={setRedemptions} />
      ) : null}

      <GoalEditSheet
        open={editGoal !== null}
        goal={editGoal === "new" ? null : editGoal}
        members={members}
        rewards={rewards}
        currentMemberId={currentMemberId}
        canAssignOthers={isApprover}
        onClose={() => setEditGoal(null)}
        onSaved={(saved) =>
          setGoals((prev) =>
            prev.some((g) => g.id === saved.id)
              ? prev.map((g) => (g.id === saved.id ? saved : g))
              : [saved, ...prev],
          )
        }
      />

      <ConfirmDialog
        open={deleteGoalId !== null}
        title="Delete goal?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteGoalId) return;
          const id = deleteGoalId;
          setDeleteGoalId(null);
          await deleteGoal(id);
        }}
        onCancel={() => setDeleteGoalId(null)}
      />
    </div>
  );
}
