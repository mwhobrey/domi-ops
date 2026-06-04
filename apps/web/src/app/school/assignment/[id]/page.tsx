import { AppShell } from "../../../../components/AppShell";
import { SchoolAssignmentDetail } from "../../../../components/SchoolAssignmentDetail";
import { apiFetch } from "../../../../lib/api";
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
  let loadError: string | null = null;

  try {
    const detail = await apiFetch<{
      assignment: { title: string };
      class: { id: string; name: string };
    }>(`/api/school/assignments/${id}`);
    assignmentTitle = detail.assignment.title;
    className = detail.class.name;
    classId = detail.class.id;
    const subRes = await apiFetch<{ submissions: typeof submissions }>(
      `/api/school/assignments/${id}/submissions`,
    );
    submissions = subRes.submissions;
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
      ) : (
        <SchoolAssignmentDetail
          assignmentId={id}
          assignmentTitle={assignmentTitle}
          className={className}
          initialSubmissions={submissions}
        />
      )}
    </AppShell>
  );
}
