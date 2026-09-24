export const dynamic = "force-dynamic";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch } from "../../../lib/api";
import { loadErrorMessage } from "../../../lib/load-error";
import type { SchoolContext } from "../../../lib/school-access";
import { Alert, Card, CardBody, EmptyState, LinkButton, SectionHeader } from "../../../components/ui";
import {
  SchoolOpenWorkList,
  type SchoolOpenWorkItem,
} from "../../../components/school/SchoolOpenWorkList";

type AssignmentFilter = "due" | "overdue";

type SchoolAssignmentSummary = SchoolOpenWorkItem;

function filterLabel(filter: AssignmentFilter): string {
  return filter === "overdue" ? "Overdue assignments" : "Due this week";
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
  let timeZone = "UTC";

  try {
    const [data, settings] = await Promise.all([
      apiFetch<{
        assignments: SchoolAssignmentSummary[];
        context: SchoolContext;
      }>(`/api/school/assignments?filter=${filter}`),
      apiFetch<{ timezone?: string }>("/api/core/household/settings").catch(() => ({
        timezone: undefined,
      })),
    ]);
    assignments = data.assignments;
    context = data.context;
    timeZone = settings.timezone?.trim() || "UTC";
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
                  {filter === "overdue"
                    ? "Past due and not turned in yet. Closing an assignment clears it from this list."
                    : "Due in the next 7 days and not turned in yet."}
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
                    ? "Everything past due has been turned in, graded, or closed."
                    : "No published assignments are due in the next 7 days."
                }
                icon={<ClipboardList className="h-10 w-10" aria-hidden />}
              />
            ) : (
              <SchoolOpenWorkList
                assignments={assignments}
                timeZone={timeZone}
                label={title}
                showStudents={context?.viewMode !== "student"}
              />
            )}
          </CardBody>
        </Card>
      )}
    </AppShell>
  );
}
