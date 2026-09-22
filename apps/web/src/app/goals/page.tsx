import { AppShell } from "../../components/AppShell";
import { GoalsPageClient } from "../../components/GoalsPageClient";
import type { NoteShareMember } from "../../components/NoteSharePicker";
import type { GoalDto, RewardDto } from "../../lib/goals-types";
import { apiFetch } from "../../lib/api";
import { sessionMemberId, sessionRole, type AuthSessionResponse } from "../../lib/session";
import { Alert } from "../../components/ui";

export default async function GoalsPage() {
  let goals: GoalDto[] = [];
  let rewards: RewardDto[] = [];
  let members: NoteShareMember[] = [];
  let currentMemberId: string | undefined;
  let role = "member";
  let loadError: string | null = null;

  try {
    const [goalsRes, rewardsRes, rosterRes, sessionRes] = await Promise.all([
      apiFetch<{ goals: GoalDto[] }>("/api/goals"),
      apiFetch<{ rewards: RewardDto[] }>("/api/goals/rewards"),
      apiFetch<{ members: NoteShareMember[] }>("/api/core/household/roster"),
      apiFetch<AuthSessionResponse>("/auth/session"),
    ]);
    goals = goalsRes.goals;
    rewards = rewardsRes.rewards;
    members = rosterRes.members;
    currentMemberId = sessionMemberId(sessionRes);
    role = sessionRole(sessionRes);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load goals";
  }

  return (
    <AppShell title="Goals">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/goals">Retry</a>
        </Alert>
      ) : (
        <GoalsPageClient
          initialGoals={goals}
          initialRewards={rewards}
          members={members}
          currentMemberId={currentMemberId}
          role={role}
        />
      )}
    </AppShell>
  );
}
