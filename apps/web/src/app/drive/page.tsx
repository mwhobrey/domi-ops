import { AppShell } from "../../components/AppShell";
import { DriveList } from "../../components/DriveList";
import type { NoteShareMember } from "../../components/NoteSharePicker";
import { apiFetch } from "../../lib/api";
import type { DriveObject } from "../../lib/drive-types";
import { Alert } from "../../components/ui";

export default async function DrivePage() {
  let objects: DriveObject[] = [];
  let members: NoteShareMember[] = [];
  let currentMemberId: string | undefined;
  let canWrite = true;
  let loadError: string | null = null;

  try {
    const [objectsRes, rosterRes, sessionRes, accessRes] = await Promise.all([
      apiFetch<{ objects: DriveObject[] }>("/api/core/drive/objects"),
      apiFetch<{ members: NoteShareMember[] }>("/api/core/household/roster"),
      apiFetch<{ memberId?: string }>("/auth/session"),
      apiFetch<{ write?: boolean }>("/api/core/drive/access").catch(() => ({ write: true })),
    ]);
    objects = objectsRes.objects;
    members = rosterRes.members;
    currentMemberId = sessionRes.memberId;
    canWrite = accessRes.write !== false;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load Drive";
  }

  return (
    <AppShell
      title="Drive"
      description="Household files and links"
      breadcrumb={[{ label: "Drive" }]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/drive">Retry</a>
        </Alert>
      ) : (
        <DriveList
          initialObjects={objects}
          members={members}
          currentMemberId={currentMemberId}
          canWrite={canWrite}
        />
      )}
    </AppShell>
  );
}
