export const dynamic = "force-dynamic";

import { AppShell } from "../../../../../components/AppShell";
import { SchoolClassGradebook } from "../../../../../components/SchoolClassGradebook";
import { apiFetch } from "../../../../../lib/api";
import type { GradebookData } from "../../../../../lib/school-gradebook";
import type { SchoolClassAccess, SchoolContext } from "../../../../../lib/school-access";
import { loadErrorMessage } from "../../../../../lib/load-error";
import { Alert } from "../../../../../components/ui";

export default async function SchoolClassGradebookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let className = "Class";
  let gradebook: GradebookData | null = null;
  let members: { id: string; shownLabel: string; email: string }[] = [];
  let access: SchoolClassAccess | null = null;
  let context: SchoolContext | null = null;
  let loadError: string | null = null;

  try {
    const [classRes, gradebookRes, memRes] = await Promise.all([
      apiFetch<{
        class: { name: string };
        access: SchoolClassAccess;
        context: SchoolContext;
      }>(`/api/school/classes/${id}`),
      apiFetch<GradebookData>(`/api/school/classes/${id}/gradebook`),
      apiFetch<{ members: typeof members }>("/api/school/members"),
    ]);
    className = classRes.class.name;
    access = classRes.access;
    context = classRes.context;
    gradebook = gradebookRes;
    members = memRes.members;

    if (access.viewMode === "student" && context) {
      gradebook = {
        ...gradebook,
        students: gradebook.students.filter((s) => s.memberId === context!.memberId),
      };
    }
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load gradebook");
  }

  if (!loadError && access && !access.canViewFullGradebook) {
    loadError = "You do not have permission to view the full gradebook for this class.";
  }

  return (
    <AppShell
      title={`${className} gradebook`}
      description="Assignment completion, scores, and missing work"
      breadcrumb={[
        { label: "School", href: "/school" },
        { label: className, href: `/school/class/${id}` },
        { label: "Gradebook" },
      ]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href={`/school/class/${id}/gradebook`}>Retry</a>
        </Alert>
      ) : gradebook ? (
        <SchoolClassGradebook classId={id} gradebook={gradebook} members={members} />
      ) : null}
    </AppShell>
  );
}
