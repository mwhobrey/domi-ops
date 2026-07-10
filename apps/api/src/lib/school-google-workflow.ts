import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  schoolAssignmentMaterials,
  schoolSubmissionArtifacts,
  schoolSubmissionGoogleCopies,
  schoolSubmissions,
} from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import {
  copyGoogleFileForStudent,
  exportGoogleFileForSnapshot,
  fetchGoogleDriveFileMetadata,
  googleFileWebUrl,
  shareGoogleFileWithEmail,
} from "./google-drive-export.js";
import {
  ensureGoogleDocsAccessToken,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "./google-docs-export.js";
import { resolveUserGoogleEmail } from "./google-user-email.js";
import { getObjectBuffer } from "./s3.js";
import {
  compareTemplateContent,
  mergeLineageResults,
  verifyGoogleSubmissionLineage,
  type LineageStatus,
} from "./school-google-lineage.js";
import { materialVisibleToViewer, type SchoolMaterialRow } from "./school-materials.js";

export function assignmentNeedsGoogleConnection(
  materials: Pick<SchoolMaterialRow, "source" | "role" | "isTest" | "frozenAt" | "studentVisible" | "observerVisible">[],
  viewMode: Parameters<typeof materialVisibleToViewer>[1],
): boolean {
  return materials.some((m) => {
    if (m.source !== "google_doc" || m.frozenAt) return false;
    if (!materialVisibleToViewer(m, viewMode)) return false;
    return m.isTest || m.role === "student_material";
  });
}

export function serializeSubmissionArtifact(
  row: typeof schoolSubmissionArtifacts.$inferSelect,
) {
  const openUrl =
    row.artifactType === "google_doc" && row.googleFileId
      ? googleFileWebUrl(row.googleFileId, row.googleMimeType)
      : row.url ?? null;
  return {
    id: row.id,
    artifactType: row.artifactType,
    s3Key: row.s3Key,
    url: row.url,
    note: row.note,
    googleFileId: row.googleFileId,
    googleMimeType: row.googleMimeType,
    googleRevisionId: row.googleRevisionId,
    materialId: row.materialId,
    lineageStatus: row.lineageStatus,
    lineageDetail: row.lineageDetail,
    openUrl,
    displayName:
      row.artifactType === "google_doc"
        ? "Google Doc submission"
        : (row.s3Key?.split("/").pop()?.replace(/^\d+-/, "") ?? "Uploaded file"),
  };
}

export async function runGoogleLineageChecks(
  db: Database,
  env: Env,
  params: {
    householdId: string;
    material: typeof schoolAssignmentMaterials.$inferSelect;
    pickedFileId: string;
    pickedMimeType: string | null;
    copyRow: typeof schoolSubmissionGoogleCopies.$inferSelect | null;
    appProperties?: Record<string, string> | null;
    studentAccessToken: string;
  },
): Promise<{ status: LineageStatus; detail: string }> {
  const lineage = verifyGoogleSubmissionLineage({
    pickedFileId: params.pickedFileId,
    copyRow: params.copyRow
      ? {
          studentGoogleFileId: params.copyRow.studentGoogleFileId,
          materialId: params.copyRow.materialId,
          templateGoogleFileId: params.copyRow.templateGoogleFileId,
        }
      : null,
    appProperties: params.appProperties,
  });

  if (!params.material.strictContentCheck) {
    return lineage;
  }

  let templateText = "";
  if (params.material.snapshotTextS3Key) {
    const buf = await getObjectBuffer(env, params.material.snapshotTextS3Key);
    if (buf) templateText = buf.toString("utf-8");
  } else if (params.material.googleFileId && params.material.createdByUserId) {
    const teacherConn = await loadGoogleDocsConnection(
      db,
      params.householdId,
      params.material.createdByUserId,
    );
    if (teacherConn) {
      try {
        const teacherToken = await ensureGoogleDocsAccessToken(db, env, teacherConn);
        const exported = await exportGoogleFileForSnapshot(teacherToken, {
          fileId: params.material.googleFileId,
          mimeType: params.material.googleMimeType,
        });
        templateText = exported.plainText;
      } catch {
        /* best-effort template export */
      }
    }
  }

  try {
    const exported = await exportGoogleFileForSnapshot(params.studentAccessToken, {
      fileId: params.pickedFileId,
      mimeType: params.pickedMimeType,
    });
    if (templateText) {
      const content = compareTemplateContent(exported.plainText, templateText);
      return mergeLineageResults([lineage, content]);
    }
    return mergeLineageResults([
      lineage,
      { status: "warn", detail: "Strict content check skipped — no template text" },
    ]);
  } catch {
    return mergeLineageResults([
      lineage,
      { status: "warn", detail: "Could not export submitted doc for content check" },
    ]);
  }
}

export async function ensureGoogleStudentCopy(
  db: Database,
  env: Env,
  params: {
    householdId: string;
    studentUserId: string;
    submissionId: string;
    material: typeof schoolAssignmentMaterials.$inferSelect;
  },
): Promise<{
  copy: typeof schoolSubmissionGoogleCopies.$inferSelect;
  openUrl: string;
}> {
  const [existing] = await db
    .select()
    .from(schoolSubmissionGoogleCopies)
    .where(
      and(
        eq(schoolSubmissionGoogleCopies.submissionId, params.submissionId),
        eq(schoolSubmissionGoogleCopies.materialId, params.material.id),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      copy: existing,
      openUrl: googleFileWebUrl(existing.studentGoogleFileId, existing.studentGoogleMimeType),
    };
  }

  if (!params.material.googleFileId) {
    throw new Error("material_missing_google_file");
  }
  if (!params.material.createdByUserId) {
    throw new Error("material_missing_teacher");
  }

  const studentEmail = await resolveUserGoogleEmail(db, params.studentUserId);
  if (!studentEmail) {
    throw new Error("google_account_email_required");
  }

  const studentConn = await loadGoogleDocsConnection(
    db,
    params.householdId,
    params.studentUserId,
  );
  if (!studentConn) {
    throw new Error("google_docs_not_connected");
  }

  const teacherConn = await loadGoogleDocsConnection(
    db,
    params.householdId,
    params.material.createdByUserId,
  );
  if (!teacherConn) {
    throw new Error("teacher_google_docs_not_connected");
  }

  let teacherToken: string;
  let studentToken: string;
  try {
    teacherToken = await ensureGoogleDocsAccessToken(db, env, teacherConn);
    studentToken = await ensureGoogleDocsAccessToken(db, env, studentConn);
  } catch (e) {
    if (e instanceof GoogleDocsCredentialsError) {
      throw new Error("google_docs_token_revoked");
    }
    throw e;
  }

  await shareGoogleFileWithEmail(teacherToken, params.material.googleFileId, studentEmail, "reader");

  const copied = await copyGoogleFileForStudent(studentToken, {
    fileId: params.material.googleFileId,
    name: `${params.material.displayName} (my copy)`,
    appProperties: {
      domi_ops_material_id: params.material.id,
      domi_ops_submission_id: params.submissionId,
      domi_ops_template_file_id: params.material.googleFileId,
    },
  });

  const [row] = await db
    .insert(schoolSubmissionGoogleCopies)
    .values({
      submissionId: params.submissionId,
      materialId: params.material.id,
      templateGoogleFileId: params.material.googleFileId,
      studentGoogleFileId: copied.id,
      studentGoogleMimeType: copied.mimeType ?? params.material.googleMimeType,
      createdByUserId: params.studentUserId,
    })
    .returning();

  return {
    copy: row!,
    openUrl: copied.webViewLink ?? googleFileWebUrl(copied.id, copied.mimeType),
  };
}
