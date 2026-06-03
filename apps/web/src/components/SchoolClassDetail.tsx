"use client";

import Link from "next/link";
import { useState } from "react";

interface Assignment {
  id: string;
  title: string;
  dueAt: string | null;
  visibility: string;
}

interface Enrollment {
  id: string;
  memberId: string;
  role: string;
}

interface Member {
  id: string;
  legacyDisplayName: string | null;
  displayName: string | null;
  email: string;
}

export function SchoolClassDetail({
  classId,
  className,
  initialAssignments,
  initialEnrollments,
  members,
}: {
  classId: string;
  className: string;
  initialAssignments: Assignment[];
  initialEnrollments: Enrollment[];
  members: Member[];
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [enrollments, setEnrollments] = useState(initialEnrollments);
  const [title, setTitle] = useState("");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");

  return (
    <div className="space-y-8">
      <p className="text-sm text-[var(--color-text-muted)]">
        <Link href="/school" className="underline">
          School
        </Link>{" "}
        / {className}
      </p>
      <section>
        <h2 className="mb-3 text-lg font-medium">Assignments</h2>
        <form
          className="mb-4 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const res = await fetch(`/api/school/classes/${classId}/assignments`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: title.trim() }),
            });
            if (res.ok) {
              const data = (await res.json()) as { assignment: Assignment };
              setAssignments((prev) => [...prev, data.assignment]);
              setTitle("");
            }
          }}
        >
          <input
            className="flex-1 rounded-xl border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
            placeholder="Assignment title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
            Add
          </button>
        </form>
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li key={a.id}>
              <Link href={`/school/assignment/${a.id}`} className="text-[var(--color-accent)] hover:underline">
                {a.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-medium">Enrollments</h2>
        <form
          className="mb-4 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!memberId) return;
            const res = await fetch(`/api/school/classes/${classId}/enrollments`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ memberId }),
            });
            if (res.ok) {
              const data = (await res.json()) as { enrollment: Enrollment };
              setEnrollments((prev) => [...prev, data.enrollment]);
            }
          }}
        >
          <select
            className="rounded-xl border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName ?? m.legacyDisplayName ?? m.email}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
            Enroll
          </button>
        </form>
        <ul className="text-sm text-[var(--color-text-muted)]">
          {enrollments.map((en) => (
            <li key={en.id}>Member {en.memberId.slice(0, 8)}… ({en.role})</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
