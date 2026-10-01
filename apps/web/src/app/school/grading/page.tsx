export const dynamic = "force-dynamic";

import Link from "next/link";
import { CheckCircle2, Clock, User } from "lucide-react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch } from "../../../lib/api";
import { loadErrorMessage } from "../../../lib/load-error";
import type { SchoolContext } from "../../../lib/school-access";
import { Alert, Badge, Card, CardBody, EmptyState, SectionHeader } from "../../../components/ui";

interface GradingQueueItem {
  submissionId: string;
  assignmentId: string;
  assignmentTitle: string;
  pointsPossible: number;
  classId: string;
  className: string;
  classSubject: string | null;
  classTerm: string | null;
  studentLabel: string;
  submittedAt: string | null;
  isLate: boolean;
  turnInCount: number;
}

/** Explicit locale + zone, so the server render and hydration produce the same text. */
function formatSubmitted(value: string | null, timeZone: string): string {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export default async function SchoolGradingPage() {
  let submissions: GradingQueueItem[] = [];
  let context: SchoolContext | null = null;
  let loadError: string | null = null;
  let timeZone = "UTC";

  try {
    const [data, settings] = await Promise.all([
      apiFetch<{ submissions: GradingQueueItem[]; context: SchoolContext }>("/api/school/grading"),
      apiFetch<{ timezone?: string }>("/api/core/household/settings").catch(() => ({
        timezone: undefined,
      })),
    ]);
    submissions = data.submissions;
    context = data.context;
    timeZone = settings.timezone?.trim() || "UTC";
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load the grading queue");
  }

  const canGrade = context?.viewMode === "admin" || context?.viewMode === "staff";

  return (
    <AppShell
      title="To grade"
      description="Everything turned in and waiting on a grade, across every class"
      breadcrumb={[{ label: "School", href: "/school" }, { label: "To grade" }]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/school/grading">Retry</a>
        </Alert>
      ) : !canGrade ? (
        <EmptyState
          title="Nothing to grade here"
          description="Grading is for teachers and household admins."
          icon={<CheckCircle2 className="h-10 w-10" aria-hidden />}
        />
      ) : (
        <Card>
          <CardBody>
            <div className="mb-4">
              <SectionHeader
                title={`${submissions.length} ${submissions.length === 1 ? "submission" : "submissions"}`}
              />
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Oldest first. A submission leaves this list once it has a grade.
              </p>
            </div>

            {submissions.length === 0 ? (
              <EmptyState
                title="All caught up"
                description="No turned-in work is waiting on a grade."
                icon={<CheckCircle2 className="h-10 w-10" aria-hidden />}
              />
            ) : (
              <ul className="space-y-2" aria-label="Submissions waiting on a grade">
                {submissions.map((s) => (
                  <li key={s.submissionId}>
                    <Link
                      href={`/school/assignment/${s.assignmentId}`}
                      className="block rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 px-4 py-3 transition hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-[var(--color-accent)]">
                            {s.assignmentTitle}
                          </p>
                          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                            {s.className}
                            {s.classSubject ? ` · ${s.classSubject}` : ""}
                            {s.classTerm ? ` · ${s.classTerm}` : ""}
                          </p>
                          <p className="mt-1 flex items-center gap-1 text-sm">
                            <User className="h-3.5 w-3.5 text-[var(--color-text-muted)]" aria-hidden />
                            {s.studentLabel}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {s.isLate ? <Badge tone="warning">Late</Badge> : null}
                          {s.turnInCount > 1 ? (
                            <Badge tone="default">Resubmitted</Badge>
                          ) : null}
                          <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                            <Clock className="h-3 w-3" aria-hidden />
                            {formatSubmitted(s.submittedAt, timeZone)}
                          </span>
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {s.pointsPossible} pts
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </AppShell>
  );
}
