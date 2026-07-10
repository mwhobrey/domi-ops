export const dynamic = "force-dynamic";

import { AppShell } from "../../../../components/AppShell";
import { SchoolClassDetail } from "../../../../components/SchoolClassDetail";
import { apiFetch } from "../../../../lib/api";
import type { GradebookData } from "../../../../lib/school-gradebook";
import type { SchoolClassAccess, SchoolContext } from "../../../../lib/school-access";
import { loadErrorMessage } from "../../../../lib/load-error";
import { Alert } from "../../../../components/ui";

export default async function SchoolClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let className = "Class";
  let classMeta = {
    id,
    name: "Class",
    subject: null as string | null,
    term: null as string | null,
    teacherMemberId: "",
    scheduleJson: null as string | null,
    archived: false,
  };
  let assignments: {
    id: string;
    title: string;
    dueAt: string | null;
    visibility: string;
    pointsPossible?: number;
    instructionsHtml?: string;
  }[] = [];
  let enrollments: {
    id: string;
    memberId: string;
    role: string;
    activeFrom: string | null;
    activeTo: string | null;
    createdAt: string;
  }[] = [];
  let members: { id: string; shownLabel: string; email: string }[] = [];
  let gradebook: GradebookData = {
    summary: {
      assignmentCount: 0,
      studentCount: 0,
      missingTotal: 0,
      overdueTotal: 0,
      gradedTotal: 0,
      classAveragePercent: null,
    },
    assignments: [],
    students: [],
  };
  let categories: {
    id: string;
    name: string;
    weightPercent: number;
    gradingPolicy: string;
  }[] = [];
  let access: SchoolClassAccess | null = null;
  let context: SchoolContext | null = null;
  let loadError: string | null = null;
  let driveEnabled = false;

  try {
    const session = await apiFetch<{ modulesEnabled?: string[] }>("/auth/session");
    driveEnabled = session.modulesEnabled?.includes("drive") ?? false;

    const detail = await apiFetch<{
      class: {
        id: string;
        name: string;
        subject: string | null;
        term: string | null;
        teacherMemberId: string;
        scheduleJson: string | null;
        archived?: boolean;
      };
      enrollments: typeof enrollments;
      access: SchoolClassAccess;
      context: SchoolContext;
    }>(`/api/school/classes/${id}`);
    className = detail.class.name;
    classMeta = { ...detail.class, archived: detail.class.archived ?? false };
    enrollments = detail.enrollments;
    access = detail.access;
    context = detail.context;
    const [assignRes, memRes, gradebookRes, catRes] = await Promise.all([
      apiFetch<{ assignments: typeof assignments }>(`/api/school/classes/${id}/assignments`),
      apiFetch<{ members: typeof members }>("/api/school/members"),
      apiFetch<GradebookData>(`/api/school/classes/${id}/gradebook`),
      apiFetch<{ categories: typeof categories }>(`/api/school/classes/${id}/categories`),
    ]);
    assignments = assignRes.assignments;
    members = memRes.members;
    gradebook = gradebookRes;
    categories = catRes.categories;
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load class");
  }

  return (
    <AppShell
      title={className}
      description={
        access?.viewMode === "student"
          ? "Assignments, progress, and your grades"
          : "Class details, progress, assignments, and roster"
      }
      breadcrumb={[
        { label: "School", href: "/school" },
        { label: className },
      ]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href={`/school/class/${id}`}>Retry</a>
        </Alert>
      ) : access && context ? (
        <SchoolClassDetail
          classId={id}
          initialClass={classMeta}
          initialAssignments={assignments}
          initialEnrollments={enrollments}
          initialGradebook={gradebook}
          initialCategories={categories}
          members={members}
          access={access}
          currentMemberId={context.memberId}
          driveEnabled={driveEnabled}
        />
      ) : (
        <Alert variant="error">Could not resolve school access for this class.</Alert>
      )}
    </AppShell>
  );
}
