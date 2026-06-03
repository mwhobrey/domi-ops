"use client";

import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Button, Card, ConfirmDialog, Textarea } from "./ui";
import { ListPage, ListPageEmpty } from "./lists/ListPage";

interface Note {
  id: string;
  content: string;
  createdAt: string;
}

export function NotesList({ initialNotes }: { initialNotes: Note[] }) {
  const [notes, setNotes] = useState(initialNotes);
  const [content, setContent] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  return (
    <ListPage
      error={error}
      onDismissError={() => setError(null)}
      addForm={
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!content.trim()) return;
            setLoading(true);
            try {
              const data = await apiClient.post<{ note: Note }>("/api/core/notes", {
                content: content.trim(),
              });
              setNotes((prev) => [data.note, ...prev]);
              setContent("");
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Failed");
            } finally {
              setLoading(false);
            }
          }}
        >
          <Textarea placeholder="New note…" value={content} onChange={(e) => setContent(e.target.value)} />
          <Button type="submit" loading={loading}>
            Add note
          </Button>
        </form>
      }
    >
      {notes.length === 0 ? (
        <ListPageEmpty title="No notes" description="Jot something down above." />
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => {
            const open = expanded === n.id;
            const preview =
              n.content.length > 120 && !open ? `${n.content.slice(0, 120)}…` : n.content;
            return (
              <li key={n.id}>
                <Card>
                  <div className="p-4">
                    <p className="whitespace-pre-wrap text-sm">{preview}</p>
                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {n.content.length > 120 && (
                        <Button variant="ghost" size="sm" onClick={() => setExpanded(open ? null : n.id)}>
                          {open ? "Collapse" : "Expand"}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(n.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete note?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteId) return;
          const id = deleteId;
          setDeleteId(null);
          setNotes((prev) => prev.filter((x) => x.id !== id));
          await apiClient.delete(`/api/core/notes/${id}`).catch(() => setError("Delete failed"));
        }}
        onCancel={() => setDeleteId(null)}
      />
    </ListPage>
  );
}
