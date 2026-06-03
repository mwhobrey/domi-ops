import { AppShell } from "../../components/AppShell";
import { NotesList } from "../../components/NotesList";
import { apiFetch } from "../../lib/api";

interface Note {
  id: string;
  content: string;
  createdAt: string;
}

export default async function NotesPage() {
  let notes: Note[] = [];
  try {
    const res = await apiFetch<{ notes: Note[] }>("/api/core/notes");
    notes = res.notes;
  } catch {
    /* */
  }

  return (
    <AppShell title="Notes">
      <NotesList initialNotes={notes} />
    </AppShell>
  );
}
