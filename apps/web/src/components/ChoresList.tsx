"use client";

import { useState } from "react";

interface Chore {
  id: string;
  description: string;
  done: boolean;
  dueDate: string | null;
}

export function ChoresList({ initialChores }: { initialChores: Chore[] }) {
  const [chores, setChores] = useState(initialChores);
  const [description, setDescription] = useState("");

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!description.trim()) return;
          const res = await fetch("/api/core/chores", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: description.trim() }),
          });
          if (res.ok) {
            const data = (await res.json()) as { chore: Chore };
            setChores((prev) => [data.chore, ...prev]);
            setDescription("");
          }
        }}
      >
        <input
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-transparent px-4 py-2 text-sm"
          placeholder="New chore…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button type="submit" className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
          Add
        </button>
      </form>
      <ul className="space-y-2">
        {chores.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] px-4 py-3"
          >
            <input
              type="checkbox"
              checked={c.done}
              onChange={async () => {
                const done = !c.done;
                setChores((prev) => prev.map((x) => (x.id === c.id ? { ...x, done } : x)));
                await fetch(`/api/core/chores/${c.id}`, {
                  method: "PATCH",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ done }),
                });
              }}
            />
            <span className={c.done ? "line-through text-[var(--color-text-muted)]" : ""}>
              {c.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
