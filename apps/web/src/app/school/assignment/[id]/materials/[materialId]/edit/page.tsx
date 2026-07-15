export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { AppShell } from "../../../../../../../components/AppShell";
import { SchoolTestEditorClient } from "../../../../../../../components/SchoolTestEditorClient";
import { Alert } from "../../../../../../../components/ui";
import { apiFetch } from "../../../../../../../lib/api";
import { loadErrorMessage } from "../../../../../../../lib/load-error";
import type { SchoolClassAccess } from "../../../../../../../lib/school-access";
import type { SchoolMaterialDto } from "../../../../../../../lib/school-materials";
import type { SchoolNativeTestPointsMode } from "../../../../../../../lib/school-test-questions";

export default async function SchoolTestEditPage({
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
  let pointsPossible: number | null = null;

  try {
    const detail = await apiFetch<{
      assignment: { title: string; pointsPossible?: number | null };
      class: { id: string; name: string };
      access: SchoolClassAccess;
      materials?: SchoolMaterialDto[];
    }>(`/api/school/assignments/${assignmentId}`);

    assignmentTitle = detail.assignment.title;
    className = detail.class.name;
    classId = detail.class.id;
    access = detail.access;
    pointsPossible = detail.assignment.pointsPossible ?? null;
    material = detail.materials?.find((m) => m.id === materialId) ?? null;

    if (!access.canEditAssignments) {
      redirect(`/school/assignment/${assignmentId}`);
    }
    if (!material || material.source !== "native_test") {
      redirect(`/school/assignment/${assignmentId}`);
    }
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load in-app test");
  }

  return (
    <AppShell
      title={material?.displayName ?? "In-app test"}
      description="Author questions, points, and preview the student view"
      breadcrumb={[
        { label: "School", href: "/school" },
        ...(classId
          ? [{ label: className, href: `/school/class/${classId}` }]
          : [{ label: className || "Class" }]),
        { label: assignmentTitle, href: `/school/assignment/${assignmentId}` },
        { label: "Edit test" },
      ]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href={`/school/assignment/${assignmentId}`}>Back to assignment</a>
        </Alert>
      ) : material && access ? (
        <SchoolTestEditorClient
          assignmentId={assignmentId}
          materialId={materialId}
          assignmentTitle={assignmentTitle}
          classId={classId}
          className={className}
          initialDisplayName={material.displayName}
          initialPointsMode={
            (material.nativeTestPointsMode as SchoolNativeTestPointsMode | undefined) ?? "explicit"
          }
          assignmentPointsPossible={pointsPossible}
          frozen={Boolean(material.frozenAt)}
        />
      ) : (
        <Alert variant="error">Could not open this in-app test.</Alert>
      )}
    </AppShell>
  );
}
