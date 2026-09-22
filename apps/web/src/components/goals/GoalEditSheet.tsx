"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import type { GoalDto, GoalVisibility, RewardDto } from "../../lib/goals-types";
import type { NoteShareMember } from "../NoteSharePicker";
import { Alert, Button, Input, Select, Sheet, Textarea } from "../ui";
import { MilestoneListEditor, type MilestoneDraft } from "./MilestoneListEditor";

function goalToDrafts(goal: GoalDto | null): MilestoneDraft[] {
  if (!goal) return [{ threshold: "", title: "", rewardId: "" }];
  if (goal.milestones.length === 0) return [{ threshold: "", title: "", rewardId: "" }];
  return goal.milestones.map((m) => ({
    id: m.id,
    threshold: String(m.threshold),
    title: m.title,
    rewardId: m.rewardId ?? "",
    locked: m.achievedAt !== null,
  }));
}

export function GoalEditSheet({
  open,
  goal,
  members,
  rewards,
  currentMemberId,
  canAssignOthers,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null = create mode. */
  goal: GoalDto | null;
  members: NoteShareMember[];
  rewards: RewardDto[];
  currentMemberId?: string;
  canAssignOthers: boolean;
  onClose: () => void;
  onSaved: (goal: GoalDto) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GoalVisibility>("household");
  const [ownerMemberId, setOwnerMemberId] = useState("");
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([{ threshold: "", title: "", rewardId: "" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(goal?.title ?? "");
    setDescription(goal?.description ?? "");
    setVisibility(goal?.visibility ?? "household");
    setOwnerMemberId(goal?.ownerMemberId ?? currentMemberId ?? "");
    setMilestones(goalToDrafts(goal));
    setError(null);
  }, [open, goal, currentMemberId]);

  const activeRewards = rewards.filter((r) => !r.archived);

  async function save() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    const parsedMilestones = milestones.map((m) => ({
      id: m.id,
      // Number("") is 0, not NaN — a blank field must fail the finite check below, not silently
      // become a threshold-0 milestone (which reads as instantly-achieved on goal creation).
      threshold: m.threshold.trim() === "" ? NaN : Number(m.threshold),
      title: m.title,
      rewardId: m.rewardId || null,
    }));
    if (parsedMilestones.some((m) => !m.title.trim() || !Number.isFinite(m.threshold))) {
      setError("Every milestone needs a title and a numeric threshold");
      return;
    }
    setLoading(true);
    setError(null);
    // Edit mode is two requests (metadata, then milestones) — not atomic. If the metadata PATCH
    // lands but the milestones PATCH then fails, the list's cached copy of this goal is stale
    // (server has the new title, client doesn't). Track whether metadata committed so the catch
    // block can refetch and hand the list the real state instead of silently going out of sync.
    let metadataCommitted = false;
    try {
      if (goal) {
        const patch = await apiClient.patch<{ goal: GoalDto }>(`/api/goals/${goal.id}`, {
          title: title.trim(),
          description: description.trim() || null,
          visibility,
        });
        metadataCommitted = true;
        const withMilestones = await apiClient.patch<{ goal: GoalDto }>(
          `/api/goals/${goal.id}/milestones`,
          { milestones: parsedMilestones },
        );
        onSaved(withMilestones.goal ?? patch.goal);
      } else {
        const created = await apiClient.post<{ goal: GoalDto }>("/api/goals", {
          title: title.trim(),
          description: description.trim() || null,
          visibility,
          ownerMemberId: canAssignOthers ? ownerMemberId || undefined : undefined,
          milestones: parsedMilestones,
        });
        onSaved(created.goal);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save goal");
      if (goal && metadataCommitted) {
        try {
          const refreshed = await apiClient.get<{ goal: GoalDto }>(`/api/goals/${goal.id}`);
          onSaved(refreshed.goal);
        } catch {
          /* best-effort — the list just keeps showing the pre-edit copy until next reload */
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={goal ? "Edit goal" : "New goal"}>
      <div className="space-y-4 p-6">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Goal title"
          aria-label="Goal title"
          disabled={loading}
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          aria-label="Goal description"
          disabled={loading}
        />
        {canAssignOthers ? (
          <div className="space-y-1">
            <span className="text-sm font-medium text-[var(--color-text)]">For</span>
            <Select
              value={ownerMemberId}
              onChange={(e) => setOwnerMemberId(e.target.value)}
              disabled={loading || goal !== null}
              aria-label="Goal owner"
            >
              {members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <span className="text-sm font-medium text-[var(--color-text)]">Visibility</span>
          <Select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as GoalVisibility)}
            disabled={loading}
            aria-label="Goal visibility"
          >
            <option value="household">Household — everyone can see it</option>
            <option value="private">Private — only you (and owner/admin)</option>
          </Select>
        </div>
        <MilestoneListEditor milestones={milestones} rewards={activeRewards} onChange={setMilestones} />
        <Button type="button" loading={loading} onClick={() => void save()}>
          {goal ? "Save changes" : "Create goal"}
        </Button>
      </div>
    </Sheet>
  );
}
