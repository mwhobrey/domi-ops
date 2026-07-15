export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { AppShell } from "../../../../../../../components/AppShell";
import { SchoolTestTakerClient } from "../../../../../../../components/SchoolTestTakerClient";
import { Alert } from "../../../../../../../components/ui";
import { apiFetch } from "../../../../../../../lib/api";
import { loadErrorMessage } from "../../../../../../../lib/load-error";
import type { SchoolClassAccess } from "../../../../../../../lib/school-access";
import type { SchoolMaterialDto } from "../../../../../../../lib/school-materials";

export default async function SchoolTestTakePage({
  params,
}: {
  params: Promise<{ id: string; materialId: string }>;
}) {
  const { id: assignmentId, materialId } = await params;
  let loadError: string | null = null;
  let assignmentTitle = "Assignment";
  let className = "";
  let classId = "";
  let material: SchoolMaterialDto | null = null;
  let access: SchoolClassAccess | null = null;

  try {
    const detail = await apiFetch<{
      assignment: { title: string };
      class: { id: string; name: string };
      access: SchoolClassAccess;
      materials?: SchoolMaterialDto[];
    }>(`/api/school/assignments/${assignmentId}`);

    assignmentTitle = detail.assignment.title;
    className = detail.class.name;
    classId = detail.class.id;
    access = detail.access;
    material = detail.materials?.find((m) => m.id === materialId) ?? null;

    if (!material || material.source !== "native_test") {
      redirect(`/school/assignment/${assignmentId}`);
    }
    if (access.canEditAssignments && !access.canSubmit) {
      redirect(`/school/assignment/${assignmentId}/materials/${materialId}/edit`);
    }
    if (!access.canSubmit && access.viewMode !== "observer") {
      redirect(`/school/assignment/${assignmentId}`);
    }
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load in-app test");
  }

  return (
    <AppShell
      title={material?.displayName ?? "Take test"}
      description="Answer questions and turn in when ready"
      breadcrumb={[
        { label: "School", href: "/school" },
        ...(classId
          ? [{ label: className, href: `/school/class/${classId}` }]
          : [{ label: className || "Class" }]),
        { label: assignmentTitle, href: `/school/assignment/${assignmentId}` },
        { label: "Take test" },
      ]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href={`/school/assignment/${assignmentId}`}>Back to assignment</a>
        </Alert>
      ) : material && access ? (
        <SchoolTestTakerClient
          assignmentId={assignmentId}
          materialId={materialId}
          assignmentTitle={assignmentTitle}
          classId={classId}
          className={className}
        />
      ) : (
        <Alert variant="error">Could not open this test.</Alert>
      )}
    </AppShell>
  );
}
