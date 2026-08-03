import { AppShell } from "../../../components/AppShell";
import { HealthSharingClient } from "../../../components/HealthSharingClient";
import type { NoteShareMember } from "../../../components/NoteSharePicker";
import { apiFetch } from "../../../lib/api";
import { Alert, LinkButton } from "../../../components/ui";

export default async function HealthSharingPage() {
  let members: NoteShareMember[] = [];
  let currentMemberId = "";
  let householdRole = "member";
  let loadError: string | null = null;

  try {
    const [rosterData, session] = await Promise.all([
      apiFetch<{ members: NoteShareMember[] }>("/api/core/household/roster"),
      apiFetch<{ memberId?: string; role?: string }>("/auth/session"),
    ]);
    members = rosterData.members ?? [];
    currentMemberId = session.memberId ?? "";
    householdRole = session.role ?? "member";
  } catch {
    loadError = "Could not load household roster.";
  }

  return (
    <AppShell
      title="Health sharing"
      description="Manage who can access health data and private record shares"
      breadcrumb={[
        { label: "Health", href: "/health" },
        { label: "Sharing" },
      ]}
      actions={
        <LinkButton href="/health" variant="ghost" size="sm">
          Back to health
        </LinkButton>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      <HealthSharingClient
        members={members}
        currentMemberId={currentMemberId}
        householdRole={householdRole}
      />
    </AppShell>
  );
}
