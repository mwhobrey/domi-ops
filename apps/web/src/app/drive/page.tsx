import { Suspense } from "react";
import { AppShell } from "../../components/AppShell";
import { DriveList } from "../../components/DriveList";
import type { NoteShareMember } from "../../components/NoteSharePicker";
import { apiFetch } from "../../lib/api";
import type { DriveFolder, DriveObject } from "../../lib/drive-types";
import { Alert } from "../../components/ui";

async function DrivePageContent() {
  let objects: DriveObject[] = [];
  let folders: DriveFolder[] = [];
  let members: NoteShareMember[] = [];
  let currentMemberId: string | undefined;
  let canWrite = true;
  let publicSharesEnabled = true;
  let loadError: string | null = null;

  try {
    const [objectsRes, foldersRes, rosterRes, sessionRes, accessRes, settingsRes] =
      await Promise.all([
        apiFetch<{ objects: DriveObject[] }>("/api/core/drive/objects"),
        apiFetch<{ folders: DriveFolder[] }>("/api/core/drive/folders"),
        apiFetch<{ members: NoteShareMember[] }>("/api/core/household/roster"),
        apiFetch<{ memberId?: string }>("/auth/session"),
        apiFetch<{ write?: boolean }>("/api/core/drive/access").catch(() => ({ write: true })),
        apiFetch<{ drivePublicSharesEnabled?: boolean }>("/api/core/household/settings").catch(
          () => ({ drivePublicSharesEnabled: true }),
        ),
      ]);
    objects = objectsRes.objects;
    folders = foldersRes.folders;
    members = rosterRes.members;
    currentMemberId = sessionRes.memberId;
    canWrite = accessRes.write !== false;
    publicSharesEnabled = settingsRes.drivePublicSharesEnabled !== false;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load Drive";
  }

  return (
    <>
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/drive">Retry</a>
        </Alert>
      ) : (
        <DriveList
          initialObjects={objects}
          initialFolders={folders}
          members={members}
          currentMemberId={currentMemberId}
          canWrite={canWrite}
          publicSharesEnabled={publicSharesEnabled}
        />
      )}
    </>
  );
}

export default async function DrivePage() {
  return (
    <AppShell
      title="Drive"
      breadcrumb={[{ label: "Drive" }]}
    >
      <Suspense fallback={<p className="text-sm text-[var(--color-text-muted)]">Loading Drive…</p>}>
        <DrivePageContent />
      </Suspense>
    </AppShell>
  );
}
