import { googleFileOpenUrl } from "./google-picker";

export type SchoolMaterialRole =
  | "student_material"
  | "handout"
  | "answer_key"
  | "rubric"
  | "reference";

export type SchoolMaterialSource =
  | "domi_drive_file"
  | "domi_drive_link"
  | "external_url"
  | "google_doc"
  | "native_test";

export interface SchoolMaterialDto {
  id: string;
  assignmentId: string;
  role: SchoolMaterialRole;
  source: SchoolMaterialSource;
  displayName: string;
  sortOrder: number;
  driveObjectId: string | null;
  externalUrl: string | null;
  isTest: boolean;
  studentVisible: boolean;
  observerVisible: boolean;
  frozenAt: string | null;
  hasSnapshot: boolean;
  driveObject: { id: string; title: string; kind: string; url: string | null } | null;
  googleFileId?: string | null;
  googleMimeType?: string | null;
  strictContentCheck?: boolean;
  nativeTestPointsMode?: "explicit" | "weighted";
}

export const MATERIAL_ROLE_LABELS: Record<SchoolMaterialRole, string> = {
  student_material: "Student material",
  handout: "Handout",
  answer_key: "Answer key",
  rubric: "Rubric",
  reference: "Reference",
};

export function getMaterialActionLabel(material: Pick<SchoolMaterialDto, "role" | "isTest" | "source">): string {
  if (material.source === "native_test") return "Take test";
  if (material.isTest || material.role === "student_material") return "Open test";
  if (material.role === "handout") return "Open handout";
  if (material.role === "rubric") return "View rubric";
  if (material.role === "reference") return "Open reference";
  return "Open";
}

export function materialOpenUrl(
  assignmentId: string,
  material: SchoolMaterialDto,
): string | null {
  if (material.frozenAt && material.hasSnapshot) {
    return `/api/school/assignments/${assignmentId}/materials/${material.id}/snapshot`;
  }
  if (material.source === "google_doc" && material.googleFileId) {
    return googleFileOpenUrl(material.googleFileId, material.googleMimeType);
  }
  if (material.source === "domi_drive_file" && material.driveObjectId) {
    return `/api/core/drive/objects/${material.driveObjectId}/file`;
  }
  if (material.externalUrl) return material.externalUrl;
  if (material.driveObject?.url) return material.driveObject.url;
  return null;
}

/** Teacher full-page builder for `native_test` materials (WHO-218). */
export function nativeTestEditUrl(assignmentId: string, materialId: string): string {
  return `/school/assignment/${assignmentId}/materials/${materialId}/edit`;
}

/** Student take page for `native_test` materials (WHO-215). */
export function nativeTestTakeUrl(assignmentId: string, materialId: string): string {
  return `/school/assignment/${assignmentId}/materials/${materialId}/take`;
}

export function formatAttemptsRemaining(maxAttempts: number | null | undefined, turnInCount: number): string | null {
  if (maxAttempts == null) return null;
  const remaining = Math.max(0, maxAttempts - turnInCount);
  return `${remaining} of ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"} remaining`;
}

export function isAttemptsExhausted(
  maxAttempts: number | null | undefined,
  turnInCount: number,
): boolean {
  if (maxAttempts == null) return false;
  return turnInCount >= maxAttempts;
}
