"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, Input, Select } from "./ui";

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
  shownLabel: string;
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
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {error && <Alert variant="error">{error}</Alert>}
      <p className="text-sm text-[var(--color-text-muted)]">
        <Link href="/school" className="underline">
          School
        </Link>{" "}
        / {className}
      </p>
      <Card>
        <CardHeader>
          <h2 className="font-medium">Assignments</h2>
        </CardHeader>
        <CardBody>
          <form
            className="mb-4 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              setError(null);
              try {
                const data = await apiClient.post<{ assignment: Assignment }>(
                  `/api/school/classes/${classId}/assignments`,
                  { title: title.trim() },
                );
                setAssignments((prev) => [...prev, data.assignment]);
                setTitle("");
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Failed to add assignment");
              }
            }}
          >
            <Input
              className="flex-1"
              placeholder="Assignment title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Button type="submit">Add</Button>
          </form>
          {assignments.length === 0 ? (
            <EmptyState title="No assignments" description="Add one above." />
          ) : (
          <ul className="space-y-2">
            {assignments.map((a) => (
              <li key={a.id}>
                <Link href={`/school/assignment/${a.id}`}>
                  <Card className="transition hover:border-[var(--color-accent)]">
                    <CardBody className="flex items-center justify-between gap-2 py-3">
                      <span className="font-medium text-[var(--color-accent)]">{a.title}</span>
                      {a.dueAt && (
                        <span className="shrink-0 rounded-full bg-[var(--color-border)]/50 px-2 py-0.5 text-xs">
                          Due {new Date(a.dueAt).toLocaleDateString()}
                        </span>
                      )}
                    </CardBody>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-medium">Enrollments</h2>
        </CardHeader>
        <CardBody>
          <form
            className="mb-4 flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!memberId) return;
              setError(null);
              try {
                const data = await apiClient.post<{ enrollment: Enrollment }>(
                  `/api/school/classes/${classId}/enrollments`,
                  { memberId },
                );
                setEnrollments((prev) => [...prev, data.enrollment]);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Failed to enroll");
              }
            }}
          >
            <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shownLabel || m.email}
                </option>
              ))}
            </Select>
            <Button type="submit">Enroll</Button>
          </form>
          <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
            {enrollments.map((en) => (
              <li key={en.id}>
                {members.find((m) => m.id === en.memberId)?.shownLabel ?? en.memberId.slice(0, 8)} (
                {en.role})
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
