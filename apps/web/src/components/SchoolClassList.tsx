"use client";

import Link from "next/link";
import { useState } from "react";

interface SchoolClass {
  id: string;
  name: string;
  subject: string | null;
  term: string | null;
}

export function SchoolClassList({ initialClasses }: { initialClasses: SchoolClass[] }) {
  const [classes, setClasses] = useState(initialClasses);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const res = await fetch("/api/school/classes", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim(), subject: subject.trim() || undefined }),
          });
          if (res.ok) {
            const data = (await res.json()) as { class: SchoolClass };
            setClasses((prev) => [...prev, data.class]);
            setName("");
            setSubject("");
          }
        }}
      >
        <input
          className="rounded-xl border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
          placeholder="Class name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="rounded-xl border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <button type="submit" className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
          Create class
        </button>
      </form>
      <div className="grid gap-4 sm:grid-cols-2">
        {classes.length === 0 ? (
          <p className="text-[var(--color-text-muted)]">No classes yet.</p>
        ) : (
          classes.map((c) => (
            <Link
              key={c.id}
              href={`/school/class/${c.id}`}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5 hover:border-[var(--color-accent)]"
            >
              <h2 className="font-medium">{c.name}</h2>
              {c.subject && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{c.subject}</p>}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
