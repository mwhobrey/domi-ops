import { AppShell } from "../../../../components/AppShell";
import { SchoolAssignmentDetail } from "../../../../components/SchoolAssignmentDetail";
import { apiFetch } from "../../../../lib/api";

export default async function SchoolAssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let assignmentTitle = "Assignment";
  let className = "";
  let submissions: {
    id: string;
    status: string;
    studentNote: string;
    artifacts: { id: string; artifactType: string; s3Key: string | null; url: string | null }[];
    grade: { score: number | null; feedbackHtml: string } | null;
  }[] = [];

  try {
    const detail = await apiFetch<{
      assignment: { title: string };
      class: { name: string };
    }>(`/api/school/assignments/${id}`);
    assignmentTitle = detail.assignment.title;
    className = detail.class.name;
    const subRes = await apiFetch<{ submissions: typeof submissions }>(
      `/api/school/assignments/${id}/submissions`,
    );
    submissions = subRes.submissions;
  } catch {
    /* */
  }

  return (
    <AppShell title={assignmentTitle}>
      <SchoolAssignmentDetail
        assignmentId={id}
        assignmentTitle={assignmentTitle}
        className={className}
        initialSubmissions={submissions}
      />
    </AppShell>
  );
}
