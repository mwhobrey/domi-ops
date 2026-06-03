import { AppShell } from "../../../../components/AppShell";
import { SchoolClassDetail } from "../../../../components/SchoolClassDetail";
import { apiFetch } from "../../../../lib/api";

export default async function SchoolClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let className = "Class";
  let assignments: { id: string; title: string; dueAt: string | null; visibility: string }[] = [];
  let enrollments: { id: string; memberId: string; role: string }[] = [];
  let members: {
    id: string;
    legacyDisplayName: string | null;
    displayName: string | null;
    email: string;
  }[] = [];

  try {
    const detail = await apiFetch<{
      class: { name: string };
      enrollments: typeof enrollments;
    }>(`/api/school/classes/${id}`);
    className = detail.class.name;
    enrollments = detail.enrollments;
    const assignRes = await apiFetch<{ assignments: typeof assignments }>(
      `/api/school/classes/${id}/assignments`,
    );
    assignments = assignRes.assignments;
    const memRes = await apiFetch<{ members: typeof members }>("/api/school/members");
    members = memRes.members;
  } catch {
    /* */
  }

  return (
    <AppShell title={className}>
      <SchoolClassDetail
        classId={id}
        className={className}
        initialAssignments={assignments}
        initialEnrollments={enrollments}
        members={members}
      />
    </AppShell>
  );
}
