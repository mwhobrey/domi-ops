import { AppShell } from "../../../components/AppShell";
import { MedicationManagerClient } from "../../../components/health/MedicationManagerClient";
import type { NoteShareMember } from "../../../components/NoteSharePicker";
import { apiFetch } from "../../../lib/api";
import { Alert } from "../../../components/ui";

export default async function MedicationManagerPage() {
  let members: NoteShareMember[] = [];
  let currentMemberId = "";
  let loadError: string | null = null;

  try {
    const [rosterData, session] = await Promise.all([
      apiFetch<{ members: NoteShareMember[] }>("/api/core/household/roster"),
      apiFetch<{ memberId?: string }>("/auth/session"),
    ]);
    members = rosterData.members ?? [];
    currentMemberId = session.memberId ?? "";
  } catch {
    loadError = "Could not load household roster.";
  }

  return (
    <AppShell
      title="Medication manager"
      description="Set up schedules and group medications so reminders arrive together instead of one at a time."
      breadcrumb={[{ label: "Health", href: "/health" }, { label: "Medications" }]}
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      <MedicationManagerClient members={members} currentMemberId={currentMemberId} />
    </AppShell>
  );
}
