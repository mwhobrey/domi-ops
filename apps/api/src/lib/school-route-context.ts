/**
 * Shared context/access helpers for the school route files (school-classes.ts,
 * school-assignments.ts, school-materials.ts). Extracted verbatim from the school.ts monolith
 * these three files replaced — every one of these is called from at least two of them, so they
 * live here rather than being copy-pasted per file.
 */
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { driveObjects, householdMembers, schoolAssignmentMaterials, schoolAssignments, schoolClasses, schoolEnrollments } from "@domi-ops/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { AuthContext } from "@domi-ops/auth";
import { driveVisibleWhere } from "./drive.js";
import { downloadPublicHttpsFile } from "./safe-public-download.js";
import {
  resolveClassAccess,
  resolveSchoolContext,
  visibleClassIdsForMember,
  type MemberEnrollmentRow,
  type SchoolClassAccess,
} from "./school-access.js";
import {
  ensureGoogleDocsAccessToken,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "./google-docs-export.js";
import { exportGoogleFileForSnapshot, googleFileWebUrl } from "./google-drive-export.js";
import { materialVisibleToViewer, serializeMaterial, type SchoolMaterialSource } from "./school-materials.js";
import { getObjectBuffer } from "./s3.js";

export async function memberForUser(
  db: Database,
  householdId: string,
  userId: string,
): Promise<{ id: string; role: string } | null> {
  const [hm] = await db
    .select({ id: householdMembers.id, role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId), isNull(householdMembers.accessRevokedAt)))
    .limit(1);
  return hm ?? null;
}

export async function classForHousehold(db: Database, classId: string, householdId: string) {
  const [row] = await db
    .select({ id: schoolClasses.id })
    .from(schoolClasses)
    .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function enrollmentForHousehold(db: Database, enrollmentId: string, householdId: string) {
  const [row] = await db
    .select({ id: schoolEnrollments.id, classId: schoolEnrollments.classId })
    .from(schoolEnrollments)
    .innerJoin(schoolClasses, eq(schoolEnrollments.classId, schoolClasses.id))
    .where(
      and(eq(schoolEnrollments.id, enrollmentId), eq(schoolClasses.householdId, householdId)),
    )
    .limit(1);
  return row ?? null;
}

export async function memberEnrollmentsForHousehold(
  db: Database,
  householdId: string,
  memberId: string,
): Promise<MemberEnrollmentRow[]> {
  const rows = await db
    .select({
      classId: schoolEnrollments.classId,
      role: schoolEnrollments.role,
      activeFrom: schoolEnrollments.activeFrom,
      activeTo: schoolEnrollments.activeTo,
    })
    .from(schoolEnrollments)
    .innerJoin(schoolClasses, eq(schoolEnrollments.classId, schoolClasses.id))
    .where(
      and(eq(schoolClasses.householdId, householdId), eq(schoolEnrollments.memberId, memberId)),
    );
  return rows;
}

export async function schoolContextForAuth(db: Database, auth: { householdId: string; userId: string }) {
  const hm = await memberForUser(db, auth.householdId, auth.userId);
  if (!hm) return null;
  const enrollments = await memberEnrollmentsForHousehold(db, auth.householdId, hm.id);
  const taught = await db
    .select({ id: schoolClasses.id })
    .from(schoolClasses)
    .where(
      and(
        eq(schoolClasses.householdId, auth.householdId),
        eq(schoolClasses.teacherMemberId, hm.id),
      ),
    );
  return resolveSchoolContext({
    memberId: hm.id,
    householdRole: hm.role,
    enrollments,
    taughtClassIds: taught.map((t) => t.id),
  });
}

export async function assignmentAccessForAuth(
  db: Database,
  auth: { householdId: string; userId: string },
  assignmentId: string,
): Promise<
  | {
      assignment: typeof schoolAssignments.$inferSelect;
      cls: typeof schoolClasses.$inferSelect;
      access: SchoolClassAccess;
      context: NonNullable<Awaited<ReturnType<typeof schoolContextForAuth>>>;
    }
  | null
> {
  const context = await schoolContextForAuth(db, auth);
  if (!context) return null;
  const [assignmentRow] = await db
    .select()
    .from(schoolAssignments)
    .where(eq(schoolAssignments.id, assignmentId))
    .limit(1);
  if (!assignmentRow) return null;
  const [cls] = await db
    .select()
    .from(schoolClasses)
    .where(
      and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
    )
    .limit(1);
  if (!cls) return null;

  const memberEnrollments = await memberEnrollmentsForHousehold(
    db,
    auth.householdId,
    context.memberId,
  );
  const visibleIds = visibleClassIdsForMember({
    memberId: context.memberId,
    householdRole: context.householdRole,
    classes: [
      {
        id: cls.id,
        teacherMemberId: cls.teacherMemberId,
        archived: cls.archived ?? false,
      },
    ],
    enrollments: memberEnrollments,
    includeArchived: true,
  });
  if (!visibleIds.includes(cls.id)) return null;

  const [myEnrollment] = await db
    .select()
    .from(schoolEnrollments)
    .where(
      and(eq(schoolEnrollments.classId, cls.id), eq(schoolEnrollments.memberId, context.memberId)),
    )
    .limit(1);
  const access = resolveClassAccess({
    memberId: context.memberId,
    householdRole: context.householdRole,
    teacherMemberId: cls.teacherMemberId,
    enrollment: myEnrollment ?? null,
  });

  return { assignment: assignmentRow, cls, access, context };
}

export async function loadAssignmentMaterials(
  db: Database,
  assignmentId: string,
  access: SchoolClassAccess,
) {
  const rows = await db
    .select({
      material: schoolAssignmentMaterials,
      driveObject: driveObjects,
    })
    .from(schoolAssignmentMaterials)
    .leftJoin(driveObjects, eq(schoolAssignmentMaterials.driveObjectId, driveObjects.id))
    .where(eq(schoolAssignmentMaterials.assignmentId, assignmentId))
    .orderBy(asc(schoolAssignmentMaterials.sortOrder), asc(schoolAssignmentMaterials.createdAt));

  return Promise.all(rows
    .filter((row) => materialVisibleToViewer(row.material, access.viewMode))
    .map(async (row) => {
      const authorized = row.driveObject ? await authorizedMaterialDriveObject(db, row.driveObject.householdId, row.material) : null;
      return serializeMaterial({ ...row.material, externalUrl: row.driveObject && !authorized ? null : row.material.externalUrl }, {
        viewMode: access.viewMode,
        driveObject: authorized
          ? {
              id: authorized.id,
              title: authorized.title,
              kind: authorized.kind,
              url: authorized.url,
            }
          : null,
      });
    }));
}

export async function resolveDriveSource(
  db: Database,
  auth: Pick<AuthContext, "householdId" | "userId" | "memberId">,
  driveObjectId: string,
): Promise<{ source: SchoolMaterialSource; externalUrl: string | null } | null> {
  const [obj] = await db
    .select()
    .from(driveObjects)
    .where(and(eq(driveObjects.id, driveObjectId), driveVisibleWhere(db, auth)))
    .limit(1);
  if (!obj) return null;
  if (obj.kind === "link") {
    return { source: "domi_drive_link", externalUrl: obj.url };
  }
  return { source: "domi_drive_file", externalUrl: null };
}

/** Attaching a readable Drive object is explicit sharing into a class material.
 * Recheck the attaching member's access for legacy/forged rows and revoked access. */
export async function authorizedMaterialDriveObject(db: Database, householdId: string, material: { driveObjectId: string | null; createdByUserId: string | null }) {
  if (!material.driveObjectId || !material.createdByUserId) return null;
  const member = await memberForUser(db, householdId, material.createdByUserId);
  if (!member) return null;
  const [object] = await db.select().from(driveObjects).where(and(eq(driveObjects.id, material.driveObjectId), driveVisibleWhere(db, { householdId, userId: material.createdByUserId, memberId: member.id }))).limit(1);
  return object ?? null;
}

export async function staffNativeTestMaterial(
  db: Database,
  assignmentId: string,
  materialId: string,
  canEdit: boolean,
) {
  if (!canEdit) return { error: "forbidden" as const };
  const [material] = await db
    .select()
    .from(schoolAssignmentMaterials)
    .where(
      and(
        eq(schoolAssignmentMaterials.id, materialId),
        eq(schoolAssignmentMaterials.assignmentId, assignmentId),
      ),
    )
    .limit(1);
  if (!material) return { error: "not_found" as const };
  if (material.source !== "native_test") return { error: "not_native_test" as const };
  return { material };
}

export async function loadConvertibleSourceMaterial(
  db: Database,
  env: Env,
  params: {
    householdId: string;
    userId: string;
    assignmentId: string;
    materialId: string;
  },
): Promise<
  | {
      material: typeof schoolAssignmentMaterials.$inferSelect;
      plainText: string;
      openUrl: string | null;
    }
  | { error: string; message: string }
> {
  const [material] = await db
    .select()
    .from(schoolAssignmentMaterials)
    .where(
      and(
        eq(schoolAssignmentMaterials.id, params.materialId),
        eq(schoolAssignmentMaterials.assignmentId, params.assignmentId),
      ),
    )
    .limit(1);
  if (!material) return { error: "not_found", message: "Material not found" };

  if (material.source === "google_doc" && material.googleFileId) {
    const conn = await loadGoogleDocsConnection(db, params.householdId, params.userId);
    if (!conn) {
      return {
        error: "google_docs_not_connected",
        message: "Connect Google Docs to convert this material.",
      };
    }
    let accessToken: string;
    try {
      accessToken = await ensureGoogleDocsAccessToken(db, env, conn);
    } catch (e) {
      if (e instanceof GoogleDocsCredentialsError) {
        return { error: "google_docs_token_revoked", message: e.message };
      }
      throw e;
    }
    try {
      const exported = await exportGoogleFileForSnapshot(accessToken, {
        fileId: material.googleFileId,
        mimeType: material.googleMimeType,
      });
      if (!exported.plainText.trim()) {
        return {
          error: "empty_document",
          message: "Google Doc exported with no readable text.",
        };
      }
      return {
        material,
        plainText: exported.plainText,
        openUrl: googleFileWebUrl(material.googleFileId, material.googleMimeType),
      };
    } catch (e) {
      return {
        error: "export_failed",
        message: e instanceof Error ? e.message : "Could not export Google Doc",
      };
    }
  }

  if (
    (material.source === "domi_drive_file" || material.source === "domi_drive_link") &&
    material.driveObjectId
  ) {
    const obj = await authorizedMaterialDriveObject(db, params.householdId, material);
    if (!obj) return { error: "not_found", message: "Drive object not found" };

    if (obj.s3Key) {
      if (!obj.contentType?.startsWith("text/")) {
        return {
          error: "unsupported_source",
          message: "Only text files can be converted. PDF/image OCR is not supported yet.",
        };
      }
      const buf = await getObjectBuffer(env, obj.s3Key);
      if (!buf) {
        return { error: "empty_document", message: "Drive file could not be read." };
      }
      const text = buf.toString("utf-8");
      if (!text.trim()) {
        return { error: "empty_document", message: "Drive file has no text content." };
      }
      return {
        material,
        plainText: text,
        openUrl: `/api/core/drive/objects/${obj.id}/file`,
      };
    }
    if (obj.url) {
      try {
        const res = await downloadPublicHttpsFile(obj.url, env.DRIVE_UPLOAD_MAX_BYTES);
        if (!res) {
          return { error: "export_failed", message: "The link must be a reachable public HTTPS document within the upload limit." };
        }
        const contentType = res.contentType;
        if (!contentType.startsWith("text/")) {
          return {
            error: "unsupported_source",
            message:
              "The link must return a text Content-Type. PDF/image OCR is not supported yet.",
          };
        }
        const text = res.body.toString("utf-8");
        if (!text.trim()) {
          return { error: "empty_document", message: "Drive link has no text content." };
        }
        return {
          material,
          plainText: text,
          openUrl: obj.url,
        };
      } catch (e) {
        return {
          error: "export_failed",
          message: e instanceof Error ? e.message : "Could not fetch Drive link",
        };
      }
    }
  }

  return {
    error: "unsupported_source",
    message: "Only Google Doc or Domi Drive materials can be converted.",
  };
}
