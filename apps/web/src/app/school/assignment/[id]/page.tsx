export const dynamic = "force-dynamic";

import { AppShell } from "../../../../components/AppShell";
import { SchoolAssignmentDetail } from "../../../../components/SchoolAssignmentDetail";
import { apiFetch } from "../../../../lib/api";
import type { SchoolClassAccess } from "../../../../lib/school-access";
import { loadErrorMessage } from "../../../../lib/load-error";
import { Alert } from "../../../../components/ui";

export default async function SchoolAssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let assignmentTitle = "Assignment";
  let className = "";
  let classId = "";
  let submissions: {
    id: string;
    status: string;
    studentNote: string;
    artifacts: { id: string; artifactType: string; s3Key: string | null; url: string | null }[];
    grade: { score: number | null; feedbackHtml: string } | null;
  }[] = [];
  let assignmentMeta = {
    instructionsHtml: "",
    pointsPossible: 100,
    dueAt: null as string | null,
    visibility: "assigned",
  };
  let access: SchoolClassAccess | null = null;
  let loadError: string | null = null;
  let driveEnabled = false;

  try {
    const session = await apiFetch<{ modulesEnabled?: string[] }>("/auth/session");
    driveEnabled = session.modulesEnabled?.includes("drive") ?? false;

    const detail = await apiFetch<{
      assignment: {
        title: string;
        instructionsHtml?: string;
        pointsPossible?: number;
        dueAt?: string | null;
        visibility?: string;
      };
      class: { id: string; name: string };
      access: SchoolClassAccess;
    }>(`/api/school/assignments/${id}`);
    assignmentTitle = detail.assignment.title;
    className = detail.class.name;
    classId = detail.class.id;
    assignmentMeta = {
      instructionsHtml: detail.assignment.instructionsHtml ?? "",
      pointsPossible: detail.assignment.pointsPossible ?? 100,
      dueAt: detail.assignment.dueAt ?? null,
      visibility: detail.assignment.visibility ?? "assigned",
    };
    access = detail.access;
    const subRes = await apiFetch<{ submissions: typeof submissions; access: SchoolClassAccess }>(
      `/api/school/assignments/${id}/submissions`,
    );
    submissions = subRes.submissions;
    if (!access) access = subRes.access;
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load assignment");
  }

  return (
    <AppShell
      title={assignmentTitle}
      description={className ? `${className}` : undefined}
      breadcrumb={[
        { label: "School", href: "/school" },
        ...(classId ? [{ label: className, href: `/school/class/${classId}` }] : [{ label: className }]),
        { label: assignmentTitle },
      ]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href={`/school/assignment/${id}`}>Retry</a>
        </Alert>
      ) : access ? (
        <SchoolAssignmentDetail
          assignmentId={id}
          assignmentTitle={assignmentTitle}
          className={className}
          instructionsHtml={assignmentMeta.instructionsHtml}
          pointsPossible={assignmentMeta.pointsPossible}
          dueAt={assignmentMeta.dueAt}
          visibility={assignmentMeta.visibility}
          initialSubmissions={submissions}
          access={access}
          driveEnabled={driveEnabled}
        />
      ) : (
        <Alert variant="error">Could not resolve school access for this assignment.</Alert>
      )}
    </AppShell>
  );
}
