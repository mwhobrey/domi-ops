"use client";

import { useState } from "react";

interface Note {
  id: string;
  content: string;
  createdAt: string;
}

export function NotesList({ initialNotes }: { initialNotes: Note[] }) {
  const [notes, setNotes] = useState(initialNotes);
  const [content, setContent] = useState("");

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!content.trim()) return;
          const res = await fetch("/api/core/notes", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: content.trim() }),
          });
          if (res.ok) {
            const data = (await res.json()) as { note: Note };
            setNotes((prev) => [data.note, ...prev]);
            setContent("");
          }
        }}
      >
        <textarea
          className="min-h-[80px] w-full rounded-xl border border-[var(--color-border)] bg-transparent p-3 text-sm"
          placeholder="New note…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button type="submit" className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
          Add note
        </button>
      </form>
      <ul className="space-y-3">
        {notes.map((n) => (
          <li
            key={n.id}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4"
          >
            <p className="whitespace-pre-wrap text-sm">{n.content}</p>
            <button
              type="button"
              className="mt-2 text-xs text-red-400"
              onClick={async () => {
                await fetch(`/api/core/notes/${n.id}`, {
                  method: "DELETE",
                  credentials: "include",
                });
                setNotes((prev) => prev.filter((x) => x.id !== n.id));
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
