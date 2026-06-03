import { AppShell } from "../../components/AppShell";
import { NotesList } from "../../components/NotesList";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

export default async function NotesPage() {
  let notes: { id: string; content: string; createdAt: string }[] = [];
  let loadError: string | null = null;
  try {
    const res = await apiFetch<{ notes: typeof notes }>("/api/core/notes");
    notes = res.notes;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load notes";
  }

  return (
    <AppShell title="Notes" description="Shared household notes">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/notes">Retry</a>
        </Alert>
      ) : (
        <NotesList initialNotes={notes} />
      )}
    </AppShell>
  );
}
