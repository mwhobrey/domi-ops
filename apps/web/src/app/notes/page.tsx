import { AppShell } from "../../components/AppShell";

import { NotesList } from "../../components/NotesList";

import type { NoteShareMember } from "../../components/NoteSharePicker";

import { apiFetch } from "../../lib/api";

import { Alert } from "../../components/ui";



export default async function NotesPage() {

  let notes: {

    id: string;

    title: string;

    content: string;

    pinned: boolean;

    tags: string[];

    visibility: "private" | "household";

    createdAt: string;

    createdByDisplayName?: string | null;

    isOwnedByMe?: boolean;

    sharedWithMe?: boolean;

    sharedMemberIds?: string[];

  }[] = [];

  let members: NoteShareMember[] = [];

  let currentMemberId: string | undefined;
  let driveEnabled = false;

  let loadError: string | null = null;

  try {

    const [notesRes, rosterRes, sessionRes] = await Promise.all([

      apiFetch<{ notes: typeof notes }>("/api/core/notes"),

      apiFetch<{ members: NoteShareMember[] }>("/api/core/household/roster"),

      apiFetch<{ memberId?: string; modulesEnabled?: string[] }>("/auth/session"),

    ]);

    notes = notesRes.notes;

    members = rosterRes.members;

    currentMemberId = sessionRes.memberId;
    driveEnabled = sessionRes.modulesEnabled?.includes("drive") ?? false;

  } catch (e) {

    loadError = e instanceof Error ? e.message : "Could not load notes";

  }



  return (

    <AppShell title="Notes" description="Household and private notes">

      {loadError ? (

        <Alert variant="error">

          {loadError}. <a href="/notes">Retry</a>

        </Alert>

      ) : (

        <NotesList
          initialNotes={notes}
          members={members}
          currentMemberId={currentMemberId}
          driveEnabled={driveEnabled}
        />

      )}

    </AppShell>

  );

}

