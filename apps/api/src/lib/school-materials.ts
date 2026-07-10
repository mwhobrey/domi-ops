import type { SchoolViewMode } from "./school-access.js";

export const SCHOOL_MATERIAL_ROLES = [
  "student_material",
  "handout",
  "answer_key",
  "rubric",
  "reference",
] as const;

export type SchoolMaterialRole = (typeof SCHOOL_MATERIAL_ROLES)[number];

export const SCHOOL_MATERIAL_SOURCES = [
  "domi_drive_file",
  "domi_drive_link",
  "external_url",
  "google_doc",
  "native_test",
] as const;

export type SchoolMaterialSource = (typeof SCHOOL_MATERIAL_SOURCES)[number];

export interface SchoolMaterialRow {
  id: string;
  assignmentId: string;
  role: SchoolMaterialRole;
  source: SchoolMaterialSource;
  displayName: string;
  sortOrder: number;
  driveObjectId: string | null;
  externalUrl: string | null;
  googleFileId: string | null;
  googleMimeType: string | null;
  googleRevisionId: string | null;
  isTest: boolean;
  strictContentCheck: boolean;
  studentVisible: boolean;
  observerVisible: boolean;
  frozenAt: Date | null;
  snapshotS3Key: string | null;
  snapshotTextS3Key: string | null;
  snapshotJsonS3Key: string | null;
  snapshotContentHash: string | null;
  nativeTestPointsMode: "explicit" | "weighted" | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface MaterialInput {
  role?: SchoolMaterialRole;
  source?: SchoolMaterialSource;
  displayName?: string;
  sortOrder?: number;
  driveObjectId?: string | null;
  externalUrl?: string | null;
  googleFileId?: string | null;
  googleMimeType?: string | null;
  isTest?: boolean;
  strictContentCheck?: boolean;
  nativeTestPointsMode?: "explicit" | "weighted";
  studentVisible?: boolean;
  observerVisible?: boolean;
}

export function defaultVisibilityForRole(role: SchoolMaterialRole): {
  studentVisible: boolean;
  observerVisible: boolean;
} {
  if (role === "answer_key") {
    return { studentVisible: false, observerVisible: false };
  }
  if (role === "rubric") {
    return { studentVisible: false, observerVisible: false };
  }
  return { studentVisible: true, observerVisible: false };
}

export function materialVisibleToViewer(
  material: Pick<SchoolMaterialRow, "role" | "studentVisible" | "observerVisible">,
  viewMode: SchoolViewMode,
): boolean {
  if (viewMode === "admin" || viewMode === "staff") return true;
  if (material.role === "answer_key") return false;
  if (viewMode === "student") return material.studentVisible;
  if (viewMode === "observer") {
    return material.observerVisible || material.studentVisible;
  }
  return false;
}

export function canTeacherViewMaterials(viewMode: SchoolViewMode): boolean {
  return viewMode === "admin" || viewMode === "staff";
}

export function validateMaterialInput(
  body: MaterialInput,
  opts?: { isFrozen?: boolean; isCreate?: boolean },
): { ok: true; value: Required<Pick<MaterialInput, "role" | "source" | "displayName">> & MaterialInput } | { ok: false; error: string } {
  if (opts?.isFrozen) {
    const mutating =
      body.role !== undefined ||
      body.source !== undefined ||
      body.driveObjectId !== undefined ||
      body.externalUrl !== undefined ||
      body.isTest !== undefined ||
      body.strictContentCheck !== undefined;
    if (mutating) return { ok: false, error: "material_frozen" };
  }

  const role = body.role ?? "handout";
  if (!SCHOOL_MATERIAL_ROLES.includes(role)) return { ok: false, error: "invalid_role" };

  const source = body.source;
  if (opts?.isCreate && !source) return { ok: false, error: "source_required" };
  if (source && !SCHOOL_MATERIAL_SOURCES.includes(source)) return { ok: false, error: "invalid_source" };

  const displayName = body.displayName?.trim();
  if (opts?.isCreate && !displayName) return { ok: false, error: "display_name_required" };

  let studentVisible = body.studentVisible;
  let observerVisible = body.observerVisible;
  const defaults = defaultVisibilityForRole(role);
  if (studentVisible === undefined) studentVisible = defaults.studentVisible;
  if (observerVisible === undefined) observerVisible = defaults.observerVisible;

  if (role === "answer_key" && studentVisible) {
    return { ok: false, error: "answer_key_not_student_visible" };
  }

  if (source === "external_url" && opts?.isCreate) {
    const url = body.externalUrl?.trim();
    if (!url) return { ok: false, error: "external_url_required" };
  }

  if ((source === "domi_drive_file" || source === "domi_drive_link") && opts?.isCreate) {
    if (!body.driveObjectId?.trim()) return { ok: false, error: "drive_object_required" };
  }

  if (source === "google_doc" && opts?.isCreate) {
    if (!body.googleFileId?.trim()) return { ok: false, error: "google_file_required" };
  }

  if (source === "native_test" && opts?.isCreate) {
    if (!displayName) return { ok: false, error: "display_name_required" };
  }

  return {
    ok: true,
    value: {
      ...body,
      role,
      source: source!,
      displayName: displayName!,
      studentVisible,
      observerVisible,
    },
  };
}

export function serializeMaterial(
  row: SchoolMaterialRow,
  opts: { viewMode: SchoolViewMode; driveObject?: { id: string; title: string; kind: string; url: string | null } | null },
) {
  const base = {
    id: row.id,
    assignmentId: row.assignmentId,
    role: row.role,
    source: row.source,
    displayName: row.displayName,
    sortOrder: row.sortOrder,
    driveObjectId: row.driveObjectId,
    externalUrl: row.externalUrl,
    isTest: row.isTest,
    strictContentCheck: row.strictContentCheck,
    studentVisible: row.studentVisible,
    observerVisible: row.observerVisible,
    frozenAt: row.frozenAt?.toISOString() ?? null,
    hasSnapshot: Boolean(row.snapshotS3Key || row.snapshotJsonS3Key),
    driveObject: opts.driveObject ?? null,
    ...(row.source === "google_doc" && !row.frozenAt
      ? { googleFileId: row.googleFileId, googleMimeType: row.googleMimeType }
      : {}),
    ...(row.source === "native_test"
      ? { nativeTestPointsMode: row.nativeTestPointsMode ?? "explicit" }
      : {}),
  };

  if (canTeacherViewMaterials(opts.viewMode)) {
    return {
      ...base,
      googleFileId: row.googleFileId,
      googleMimeType: row.googleMimeType,
      strictContentCheck: row.strictContentCheck,
      snapshotContentHash: row.snapshotContentHash,
    };
  }

  return base;
}

export function attemptsRemaining(
  maxAttempts: number | null | undefined,
  turnInCount: number,
): number | null {
  if (maxAttempts == null) return null;
  return Math.max(0, maxAttempts - turnInCount);
}

export function isAttemptsExhausted(
  maxAttempts: number | null | undefined,
  turnInCount: number,
): boolean {
  if (maxAttempts == null) return false;
  return turnInCount >= maxAttempts;
}
