export const dynamic = "force-dynamic";

import Link from "next/link";
import { Calendar, ClipboardList } from "lucide-react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch } from "../../../lib/api";
import { loadErrorMessage } from "../../../lib/load-error";
import type { SchoolContext } from "../../../lib/school-access";
import { Alert, Badge, Card, CardBody, EmptyState, LinkButton, SectionHeader } from "../../../components/ui";

type AssignmentFilter = "due" | "overdue";

interface SchoolAssignmentSummary {
  id: string;
  title: string;
  dueAt: string;
  overdue: boolean;
  visibility: string;
  pointsPossible: number | null;
  classId: string;
  className: string;
  classSubject: string | null;
  classTerm: string | null;
}

function filterLabel(filter: AssignmentFilter): string {
  return filter === "overdue" ? "Overdue assignments" : "Due this week";
}

function formatDue(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SchoolAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter: AssignmentFilter = params.filter === "overdue" ? "overdue" : "due";
  let assignments: SchoolAssignmentSummary[] = [];
  let context: SchoolContext | null = null;
  let loadError: string | null = null;

  try {
    const data = await apiFetch<{
      assignments: SchoolAssignmentSummary[];
      context: SchoolContext;
    }>(`/api/school/assignments?filter=${filter}`);
    assignments = data.assignments;
    context = data.context;
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load assignments");
  }

  const title = filterLabel(filter);

  return (
    <AppShell
      title={title}
      description={
        context?.viewMode === "student"
          ? "Your urgent school work across every class"
          : "Open school work across every class, without drilling into each class"
      }
      breadcrumb={[
        { label: "School", href: "/school" },
        { label: title },
      ]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href={`/school/assignments?filter=${filter}`}>Retry</a>
        </Alert>
      ) : (
        <Card>
          <CardBody>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <SectionHeader
                  title={`${assignments.length} ${assignments.length === 1 ? "assignment" : "assignments"}`}
                />
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {filter === "overdue" ? "Past due and still open." : "Due in the next 7 days."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <LinkButton
                  href="/school/assignments?filter=due"
                  size="sm"
                  variant={filter === "due" ? "primary" : "secondary"}
                >
                  Due this week
                </LinkButton>
                <LinkButton
                  href="/school/assignments?filter=overdue"
                  size="sm"
                  variant={filter === "overdue" ? "primary" : "secondary"}
                >
                  Overdue
                </LinkButton>
              </div>
            </div>

            {assignments.length === 0 ? (
              <EmptyState
                title={filter === "overdue" ? "Nothing overdue" : "Nothing due this week"}
                description={
                  filter === "overdue"
                    ? "No published assignments are past due right now."
                    : "No published assignments are due in the next 7 days."
                }
                icon={<ClipboardList className="h-10 w-10" aria-hidden />}
              />
            ) : (
              <ul className="space-y-2" aria-label={title}>
                {assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <Link
                      href={`/school/assignment/${assignment.id}`}
                      className="block rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 px-4 py-3 transition hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
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
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={assignment.overdue ? "warning" : "default"}>
                            {assignment.overdue ? "Overdue" : "Due"}
                          </Badge>
                          <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                            <Calendar className="h-3 w-3" aria-hidden />
                            {formatDue(assignment.dueAt)}
                          </span>
                          {assignment.pointsPossible != null ? (
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {assignment.pointsPossible} pts
                            </span>
                          ) : null}
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
