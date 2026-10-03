import { AppShell } from "../../components/AppShell";
import { HealthPageClient } from "../../components/HealthPageClient";
import type { NoteShareMember } from "../../components/NoteSharePicker";
import { apiFetch } from "../../lib/api";
import { sessionMemberId, type AuthSessionResponse } from "../../lib/session";
import { Alert } from "../../components/ui";

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{
    event?: string;
    medication?: string;
    take?: string;
    takeGroup?: string;
    check?: string;
    checkGroup?: string;
    action?: string;
    scheduledAt?: string;
    token?: string;
  }>;
}) {
  const params = await searchParams;
  let members: NoteShareMember[] = [];
  let currentMemberId = "";
  let householdTimezone = "UTC";
  let loadError: string | null = null;

  try {
    const [rosterData, session] = await Promise.all([
      apiFetch<{ members: NoteShareMember[] }>("/api/core/household/roster"),
      apiFetch<AuthSessionResponse>("/auth/session"),
    ]);
    members = rosterData.members ?? [];
    currentMemberId = sessionMemberId(session);
    householdTimezone = session.householdTimezone?.trim() || "UTC";
  } catch {
    loadError = "Could not load household roster.";
  }

  return (
    <AppShell title="Health" description="Symptoms, appointments, and medications">
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      <HealthPageClient
        members={members}
        currentMemberId={currentMemberId}
        householdTimezone={householdTimezone}
        initialEventId={params.event}
        initialMedicationId={params.medication}
        initialTakeMedicationId={params.take}
        initialTakeGroupId={params.takeGroup}
        initialTakeScheduledAt={params.scheduledAt}
        initialCheckId={params.check}
        initialCheckGroupId={params.checkGroup}
        initialCheckScheduledAt={params.scheduledAt}
        pushAction={
          params.token && params.action && params.scheduledAt && params.medication
            ? {
                medicationId: params.medication,
                action: params.action,
                scheduledAt: params.scheduledAt,
                token: params.token,
              }
            : undefined
        }
      />
    </AppShell>
  );
}
