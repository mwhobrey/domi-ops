"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { Alert, Badge, Button, Checkbox, ConfirmDialog } from "../ui";

export interface SchoolOpenWorkItem {
  id: string;
  title: string;
  dueAt: string;
  overdue: boolean;
  pointsPossible: number | null;
  classId: string;
  className: string;
  classSubject: string | null;
  classTerm: string | null;
  /** Students who still owe this assignment. */
  students?: { memberId: string; label: string }[];
  /** Viewer can close this assignment (teacher / staff / household admin). */
  canClose?: boolean;
}

/** Explicit locale + zone, so the server render and hydration produce the same text. */
function formatDue(value: string, timeZone: string): string {
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export function SchoolOpenWorkList({
  assignments,
  timeZone,
  label,
  showStudents,
}: {
  assignments: SchoolOpenWorkItem[];
  timeZone: string;
  label: string;
  /** Hide the "who owes it" line for a student looking at their own work. */
  showStudents: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excusingKey, setExcusingKey] = useState<string | null>(null);

  async function excuse(assignmentId: string, studentMemberId: string) {
    setExcusingKey(`${assignmentId}:${studentMemberId}`);
    setError(null);
    try {
      await apiClient.post(`/api/school/assignments/${assignmentId}/excuse`, {
        studentMemberId,
        excused: true,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not excuse that student");
    } finally {
      setExcusingKey(null);
    }
  }

  const closable = useMemo(
    () => assignments.filter((a) => a.overdue && a.canClose).map((a) => a.id),
    [assignments],
  );
  // Selection can outlive a refresh or a failed close; only ids still on the list count.
  const selectedIds = useMemo(() => closable.filter((id) => selected.has(id)), [closable, selected]);
  const allSelected = closable.length > 0 && selectedIds.length === closable.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function closeSelected() {
    setConfirmOpen(false);
    setClosing(true);
    setError(null);
    try {
      await apiClient.post("/api/school/assignments/close", { ids: selectedIds });
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not close those assignments");
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {closable.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] bg-[var(--color-surface-subtle)] px-3 py-2">
          <Checkbox
            label={allSelected ? "Clear selection" : "Select all"}
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(closable))}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={selectedIds.length === 0}
            loading={closing}
            onClick={() => setConfirmOpen(true)}
          >
            Close {selectedIds.length > 0 ? selectedIds.length : ""} selected
          </Button>
        </div>
      ) : null}

      <ul className="space-y-2" aria-label={label}>
        {assignments.map((assignment) => {
          const selectable = assignment.overdue && assignment.canClose;
          const students = assignment.students ?? [];
          return (
            <li key={assignment.id} className="flex items-start gap-2">
              {selectable ? (
                <span className="pt-3.5">
                  <Checkbox
                    aria-label={`Select ${assignment.title}`}
                    checked={selected.has(assignment.id)}
                    onChange={() => toggle(assignment.id)}
                  />
                </span>
              ) : null}
              <div className="min-w-0 flex-1 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 transition hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-surface-subtle)]">
              <Link
                href={`/school/assignment/${assignment.id}`}
                className="block rounded-[var(--radius-lg)] px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[var(--color-accent)]">
                      {assignment.title}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      {assignment.className}
                      {assignment.classSubject ? ` · ${assignment.classSubject}` : ""}
                      {assignment.classTerm ? ` · ${assignment.classTerm}` : ""}
                    </p>
                    {showStudents && students.length > 0 && !assignment.canClose ? (
                      <p className="mt-1 flex items-center gap-1 text-sm">
                        <Users className="h-3.5 w-3.5 text-[var(--color-text-muted)]" aria-hidden />
                        <span className="sr-only">Still owed by </span>
                        {students.map((s) => s.label).join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={assignment.overdue ? "warning" : "default"}>
                      {assignment.overdue ? "Overdue" : "Due"}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                      <Calendar className="h-3 w-3" aria-hidden />
                      {formatDue(assignment.dueAt, timeZone)}
                    </span>
                    {assignment.pointsPossible != null ? (
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {assignment.pointsPossible} pts
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
              {showStudents && students.length > 0 && assignment.canClose ? (
                // Outside the link: each chip excuses one student, it doesn't navigate.
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                  <Users className="h-3.5 w-3.5 text-[var(--color-text-muted)]" aria-hidden />
                  <span className="sr-only">Still owed by</span>
                  {students.map((s) => (
                    <span
                      key={s.memberId}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] py-0.5 pl-2.5 pr-1 text-sm"
                    >
                      {s.label}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        loading={excusingKey === `${assignment.id}:${s.memberId}`}
                        aria-label={`Excuse ${s.label} from ${assignment.title}`}
                        onClick={() => void excuse(assignment.id, s.memberId)}
                      >
                        Excuse
                      </Button>
                    </span>
                  ))}
                </div>
              ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirmOpen}
        title={`Close ${selectedIds.length} ${selectedIds.length === 1 ? "assignment" : "assignments"}?`}
        message="Closed work drops off the overdue list and the dashboard. Grades and anything already turned in stay. To reopen one, edit it in its class and set it back to Assigned."
        confirmLabel="Close"
        loading={closing}
        onConfirm={() => void closeSelected()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
