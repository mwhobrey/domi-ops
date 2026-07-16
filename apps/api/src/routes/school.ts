import { Hono } from "hono";
import { memberShownLabel } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import { isHouseholdModuleEnabled } from "../lib/household-modules.js";
import type { Database } from "@domi-ops/db";
import {
  driveObjects,
  householdMembers,
  schoolAssignmentCategories,
  schoolAssignmentMaterials,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolGrades,
  schoolSubmissionArtifacts,
  schoolSubmissionGoogleCopies,
  schoolSubmissionResponses,
  schoolSubmissions,
  schoolTestQuestions,
  users,
} from "@domi-ops/db";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  isEnrollmentActiveNow,
  resolveClassAccess,
  resolveSchoolContext,
  visibleClassIdsForMember,
  type MemberEnrollmentRow,
  type SchoolClassAccess,
} from "../lib/school-access.js";
import { publishedAssignmentVisibilities } from "../lib/school-assignment-visibility.js";
import { buildClassGradebook } from "../lib/school-gradebook.js";
import { buildSchoolReports, canViewSchoolReports } from "../lib/school-reports.js";
import { canSubmitPastDue, isSubmissionLate } from "../lib/school-submission.js";
import { freezeAssignmentTestMaterials } from "../lib/school-material-freeze.js";
import { SchoolMaterialFreezeError } from "../lib/school-material-freeze-errors.js";
import {
  exportGoogleFileForSnapshot,
  fetchGoogleDriveFileMetadata,
  GOOGLE_FORMS_MIME,
  googleFileWebUrl,
} from "../lib/google-drive-export.js";
import {
  ensureGoogleDocsAccessToken,
  exportToGoogleDocs,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "../lib/google-docs-export.js";
import {
  formatNativeTestHtml,
  formatNativeTestPlainText,
} from "../lib/school-test-google-export.js";
import {
  parseGoogleDocTestText,
  type ParsedImportQuestion,
} from "../lib/school-test-google-import.js";
import {
  attemptsRemaining,
  isAttemptsExhausted,
  materialVisibleToViewer,
  serializeMaterial,
  validateMaterialInput,
  type SchoolMaterialSource,
} from "../lib/school-materials.js";
import { verifyGoogleSubmissionLineage } from "../lib/school-google-lineage.js";
import {
  assignmentNeedsGoogleConnection,
  ensureGoogleStudentCopy,
  runGoogleLineageChecks,
  serializeSubmissionArtifact,
} from "../lib/school-google-workflow.js";
import {
  serializeQuestionPreview,
  serializeQuestionStaff,
  validateQuestionInput,
  type SchoolNativeTestPointsMode,
  type SchoolQuestionType,
} from "../lib/school-test-questions.js";
import {
  applyNativeTestAutoGrade,
  recomputeNativeTestRollup,
  reviewQuestionMaxPoints,
} from "../lib/school-test-auto-grade.js";
import { effectiveQuestionScore } from "../lib/school-test-grading.js";
import {
  canModifySubmissionArtifacts,
  submissionAccessForAuth,
} from "../lib/school-submission-access.js";
import { contentTypeFromKey, getObjectBuffer } from "../lib/s3.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

async function memberForUser(
  db: Database,
  householdId: string,
  userId: string,
): Promise<{ id: string; role: string } | null> {
  const [hm] = await db
    .select({ id: householdMembers.id, role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .limit(1);
  return hm ?? null;
}

async function classForHousehold(db: Database, classId: string, householdId: string) {
  const [row] = await db
    .select({ id: schoolClasses.id })
    .from(schoolClasses)
    .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

async function enrollmentForHousehold(db: Database, enrollmentId: string, householdId: string) {
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

async function memberEnrollmentsForHousehold(
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

async function schoolContextForAuth(db: Database, auth: { householdId: string; userId: string }) {
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

async function assignmentAccessForAuth(
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

async function loadAssignmentMaterials(
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

  return rows
    .filter((row) => materialVisibleToViewer(row.material, access.viewMode))
    .map((row) =>
      serializeMaterial(row.material, {
        viewMode: access.viewMode,
        driveObject: row.driveObject
          ? {
              id: row.driveObject.id,
              title: row.driveObject.title,
              kind: row.driveObject.kind,
              url: row.driveObject.url,
            }
          : null,
      }),
    );
}

async function resolveDriveSource(
  db: Database,
  householdId: string,
  driveObjectId: string,
): Promise<{ source: SchoolMaterialSource; externalUrl: string | null } | null> {
  const [obj] = await db
    .select()
    .from(driveObjects)
    .where(and(eq(driveObjects.id, driveObjectId), eq(driveObjects.householdId, householdId)))
    .limit(1);
  if (!obj) return null;
  if (obj.kind === "link") {
    return { source: "domi_drive_link", externalUrl: obj.url };
  }
  return { source: "domi_drive_file", externalUrl: null };
}

async function staffNativeTestMaterial(
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

async function loadConvertibleSourceMaterial(
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
    const [obj] = await db
      .select()
      .from(driveObjects)
      .where(
        and(
          eq(driveObjects.id, material.driveObjectId),
          eq(driveObjects.householdId, params.householdId),
        ),
      )
      .limit(1);
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
        const res = await fetch(obj.url);
        if (!res.ok) {
          return { error: "export_failed", message: `Could not fetch Drive link (${res.status})` };
        }
        const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        if (!contentType.startsWith("text/")) {
          return {
            error: "unsupported_source",
            message:
              "The link must return a text Content-Type. PDF/image OCR is not supported yet.",
          };
        }
        const text = await res.text();
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

export function schoolRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/members", async (c) => {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "school"))) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const rows = await db
      .select({
        id: householdMembers.id,
        role: householdMembers.role,
        name: householdMembers.name,
        legacyDisplayName: householdMembers.legacyDisplayName,
        email: users.email,
      })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, auth.householdId));
    return c.json({
      members: rows.map((m) => ({
        ...m,
        shownLabel: memberShownLabel(m),
      })),
    });
  });

  app.get("/context", async (c) => {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "school"))) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    return c.json({ context });
  });

  app.get("/glance", async (c) => {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "school"))) {
      return c.json({ enabled: false });
    }
    const context = await schoolContextForAuth(db, auth);
    if (!context) {
      return c.json({
        enabled: true,
        classCount: 0,
        dueSoon: 0,
        overdue: 0,
        summary: { headline: "Set up", tone: "default" as const },
        items: [],
        overflow: 0,
        context: null,
      });
    }

    const allClassRows = await db
      .select({
        id: schoolClasses.id,
        teacherMemberId: schoolClasses.teacherMemberId,
        archived: schoolClasses.archived,
      })
      .from(schoolClasses)
      .where(eq(schoolClasses.householdId, auth.householdId));

    const enrollments = await memberEnrollmentsForHousehold(db, auth.householdId, context.memberId);
    const visibleIds = visibleClassIdsForMember({
      memberId: context.memberId,
      householdRole: context.householdRole,
      classes: allClassRows.map((r) => ({
        id: r.id,
        teacherMemberId: r.teacherMemberId,
        archived: r.archived ?? false,
      })),
      enrollments,
    });
    const classCount = visibleIds.length;
    if (classCount === 0) {
      return c.json({
        enabled: true,
        classCount: 0,
        dueSoon: 0,
        overdue: 0,
        summary: { headline: "Set up", tone: "default" as const },
        items: [],
        overflow: 0,
        context,
      });
    }

    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);

    const assignmentWhere =
      visibleIds.length > 0
        ? and(
            eq(schoolClasses.householdId, auth.householdId),
            inArray(schoolClasses.id, visibleIds),
            isNotNull(schoolAssignments.dueAt),
            inArray(schoolAssignments.visibility, publishedAssignmentVisibilities()),
          )
        : and(eq(schoolClasses.householdId, auth.householdId), eq(schoolClasses.id, "00000000-0000-0000-0000-000000000000"));

    const assignments = await db
      .select({
        id: schoolAssignments.id,
        title: schoolAssignments.title,
        dueAt: schoolAssignments.dueAt,
        className: schoolClasses.name,
      })
      .from(schoolAssignments)
      .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
      .where(assignmentWhere);

    type Ranked = {
      id: string;
      title: string;
      className: string;
      dueAt: string;
      overdue: boolean;
      sortKey: number;
    };

    const ranked: Ranked[] = assignments.map((row) => {
      const due = row.dueAt!;
      const overdue = due < now;
      return {
        id: row.id,
        title: row.title,
        className: row.className,
        dueAt: due.toISOString(),
        overdue,
        sortKey: due.getTime(),
      };
    });

    ranked.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return a.sortKey - b.sortKey;
    });

    const dueSoon = ranked.filter((r) => !r.overdue && new Date(r.dueAt) <= weekAhead).length;
    const overdue = ranked.filter((r) => r.overdue).length;
    const previewLimit = 4;
    const items = ranked.slice(0, previewLimit).map((r) => ({
      id: r.id,
      title: r.title,
      className: r.className,
      dueAt: r.dueAt,
      overdue: r.overdue,
    }));
    const overflow = Math.max(0, ranked.length - 3);

    let headline: string;
    let tone: "success" | "warning" | "default" = "default";
    if (overdue > 0) {
      headline = `${overdue} overdue`;
      tone = "warning";
    } else if (dueSoon > 0) {
      headline = `${dueSoon} due`;
    } else {
      headline = `${classCount} ${classCount === 1 ? "class" : "classes"}`;
      tone = "success";
    }

    return c.json({
      enabled: true,
      classCount,
      dueSoon,
      overdue,
      summary: { headline, tone },
      items,
      overflow,
      context,
    });
  });

  app.get("/assignments", async (c) => {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "school"))) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);

    const filter = c.req.query("filter") === "overdue" ? "overdue" : "due";
    const allClassRows = await db
      .select({
        id: schoolClasses.id,
        name: schoolClasses.name,
        subject: schoolClasses.subject,
        term: schoolClasses.term,
        teacherMemberId: schoolClasses.teacherMemberId,
        archived: schoolClasses.archived,
      })
      .from(schoolClasses)
      .where(eq(schoolClasses.householdId, auth.householdId));

    const enrollments = await memberEnrollmentsForHousehold(db, auth.householdId, context.memberId);
    const visibleIds = visibleClassIdsForMember({
      memberId: context.memberId,
      householdRole: context.householdRole,
      classes: allClassRows.map((r) => ({
        id: r.id,
        teacherMemberId: r.teacherMemberId,
        archived: r.archived ?? false,
      })),
      enrollments,
    });

    if (visibleIds.length === 0) {
      return c.json({ assignments: [], filter, context });
    }

    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);

    const rows = await db
      .select({
        id: schoolAssignments.id,
        title: schoolAssignments.title,
        dueAt: schoolAssignments.dueAt,
        visibility: schoolAssignments.visibility,
        pointsPossible: schoolAssignments.pointsPossible,
        classId: schoolClasses.id,
        className: schoolClasses.name,
        classSubject: schoolClasses.subject,
        classTerm: schoolClasses.term,
      })
      .from(schoolAssignments)
      .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
      .where(
        and(
          eq(schoolClasses.householdId, auth.householdId),
          inArray(schoolClasses.id, visibleIds),
          isNotNull(schoolAssignments.dueAt),
          inArray(schoolAssignments.visibility, publishedAssignmentVisibilities()),
        ),
      );

    const assignments = rows
      .map((row) => {
        const due = row.dueAt!;
        const overdue = due < now;
        return {
          ...row,
          dueAt: due.toISOString(),
          overdue,
        };
      })
      .filter((row) =>
        filter === "overdue"
          ? row.overdue
          : !row.overdue && new Date(row.dueAt).getTime() <= weekAhead.getTime(),
      )
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    return c.json({ assignments, filter, context });
  });

  app.get("/classes", async (c) => {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "school"))) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);

    const includeArchived = c.req.query("includeArchived") === "true";
    const allClasses = await db
      .select()
      .from(schoolClasses)
      .where(eq(schoolClasses.householdId, auth.householdId));

    const enrollments = await memberEnrollmentsForHousehold(db, auth.householdId, context.memberId);
    const visibleIds = new Set(
      visibleClassIdsForMember({
        memberId: context.memberId,
        householdRole: context.householdRole,
        classes: allClasses.map((cls) => ({
          id: cls.id,
          teacherMemberId: cls.teacherMemberId,
          archived: cls.archived ?? false,
        })),
        enrollments,
        includeArchived,
      }),
    );

    const enrollmentByClass = new Map(
      enrollments.map((e) => [e.classId, e.role] as const),
    );

    const classes = allClasses
      .filter((cls) => visibleIds.has(cls.id))
      .map((cls) => ({
        ...cls,
        myEnrollmentRole: enrollmentByClass.get(cls.id) ?? null,
        isClassTeacher: cls.teacherMemberId === context.memberId,
      }));

    return c.json({ classes, context });
  });

  app.post("/classes", async (c) => {
    const auth = c.get("auth")!;
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    if (!context.canCreateClass) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{ name: string; subject?: string; term?: string }>();
    const hm = await memberForUser(db, auth.householdId, auth.userId);
    if (!hm) return c.json({ error: "not_a_member" }, 403);
    const [row] = await db
      .insert(schoolClasses)
      .values({
        householdId: auth.householdId,
        name: body.name,
        subject: body.subject,
        term: body.term,
        teacherMemberId: hm.id,
      })
      .returning();
    return c.json({ class: row }, 201);
  });

  app.get("/classes/:classId", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);

    const [row] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);

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
          id: row.id,
          teacherMemberId: row.teacherMemberId,
          archived: row.archived ?? false,
        },
      ],
      enrollments: memberEnrollments,
      includeArchived: true,
    });
    if (!visibleIds.includes(classId)) return c.json({ error: "not_found" }, 404);

    const enrollments = await db
      .select()
      .from(schoolEnrollments)
      .where(eq(schoolEnrollments.classId, classId));

    const myEnrollment =
      enrollments.find((e) => e.memberId === context.memberId) ?? null;
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: row.teacherMemberId,
      enrollment: myEnrollment,
    });

    return c.json({ class: row, enrollments, access, context });
  });

  app.patch("/classes/:classId", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [existing] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const myEnrollmentRows = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, classId),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: existing.teacherMemberId,
      enrollment: myEnrollmentRows[0] ?? null,
    });
    if (!access.canEditClassMeta) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{
      name?: string;
      subject?: string | null;
      term?: string | null;
      teacherMemberId?: string;
      scheduleJson?: string;
      archived?: boolean;
    }>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.subject !== undefined) patch.subject = body.subject;
    if (body.term !== undefined) patch.term = body.term;
    if (body.teacherMemberId !== undefined) patch.teacherMemberId = body.teacherMemberId;
    if (body.scheduleJson !== undefined) patch.scheduleJson = body.scheduleJson;
    if (body.archived !== undefined) patch.archived = body.archived;
    const [row] = await db
      .update(schoolClasses)
      .set(patch)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ class: row });
  });

  app.delete("/classes/:classId", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    await db
      .delete(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/classes/:classId/enrollments", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    if (!(await classForHousehold(db, classId, auth.householdId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const rows = await db
      .select()
      .from(schoolEnrollments)
      .where(eq(schoolEnrollments.classId, classId));
    return c.json({ enrollments: rows });
  });

  app.post("/classes/:classId/enrollments", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, classId),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEnroll) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{
      memberId: string;
      role?: string;
      activeFrom?: string | null;
      activeTo?: string | null;
    }>();
    const [row] = await db
      .insert(schoolEnrollments)
      .values({
        classId,
        memberId: body.memberId,
        role: body.role ?? "student",
        activeFrom: body.activeFrom ?? null,
        activeTo: body.activeTo ?? null,
      })
      .returning();
    return c.json({ enrollment: row }, 201);
  });

  app.delete("/enrollments/:enrollmentId", async (c) => {
    const auth = c.get("auth")!;
    const enrollmentId = c.req.param("enrollmentId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const enrollment = await enrollmentForHousehold(db, enrollmentId, auth.householdId);
    if (!enrollment) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(eq(schoolClasses.id, enrollment.classId))
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, enrollment.classId),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEnroll) return c.json({ error: "forbidden" }, 403);
    await db.delete(schoolEnrollments).where(eq(schoolEnrollments.id, enrollmentId));
    return c.json({ ok: true });
  });

  app.get("/classes/:classId/assignments", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, classId),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    const rows = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.classId, classId));
    const assignments =
      access.canEditAssignments
        ? rows
        : rows.filter((a) => a.visibility !== "draft");
    return c.json({ assignments, access });
  });

  app.get("/classes/:classId/gradebook", async (c) => {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "school"))) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const classId = c.req.param("classId");
    if (!(await classForHousehold(db, classId, auth.householdId))) {
      return c.json({ error: "not_found" }, 404);
    }

    const gradebook = await buildClassGradebook(db, classId);
    return c.json(gradebook);
  });

  app.get("/reports", async (c) => {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "school"))) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    if (!canViewSchoolReports(context.viewMode, context.householdRole)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const hm = await memberForUser(db, auth.householdId, auth.userId);
    if (!hm) return c.json({ error: "not_a_member" }, 403);

    const enrollments = await memberEnrollmentsForHousehold(db, auth.householdId, hm.id);
    const memberRows = await db
      .select({
        id: householdMembers.id,
        name: householdMembers.name,
        legacyDisplayName: householdMembers.legacyDisplayName,
        email: users.email,
      })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, auth.householdId));

    const memberLabels = new Map(
      memberRows.map((m) => [m.id, memberShownLabel(m)]),
    );

    const termFilter = c.req.query("term") || null;

    const reports = await buildSchoolReports({
      db,
      householdId: auth.householdId,
      memberId: context.memberId,
      householdRole: context.householdRole,
      viewMode: context.viewMode,
      enrollments,
      memberLabels,
      termFilter,
    });

    return c.json(reports);
  });

  app.get("/classes/:classId/categories", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    if (!(await classForHousehold(db, classId, auth.householdId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const rows = await db
      .select()
      .from(schoolAssignmentCategories)
      .where(eq(schoolAssignmentCategories.classId, classId));
    return c.json({ categories: rows });
  });

  app.post("/classes/:classId/categories", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, classId),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEditCategories) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{
      name: string;
      weightPercent?: number;
      gradingPolicy?: string;
    }>();
    const [row] = await db
      .insert(schoolAssignmentCategories)
      .values({
        classId,
        name: body.name.trim(),
        weightPercent: body.weightPercent ?? 0,
        gradingPolicy: body.gradingPolicy ?? "points",
      })
      .returning();
    return c.json({ category: row }, 201);
  });

  app.patch("/categories/:categoryId", async (c) => {
    const auth = c.get("auth")!;
    const categoryId = c.req.param("categoryId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [existing] = await db
      .select({ id: schoolAssignmentCategories.id, classId: schoolAssignmentCategories.classId })
      .from(schoolAssignmentCategories)
      .where(eq(schoolAssignmentCategories.id, categoryId))
      .limit(1);
    if (!existing?.classId || !(await classForHousehold(db, existing.classId, auth.householdId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(eq(schoolClasses.id, existing.classId))
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, existing.classId),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEditCategories) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{
      name?: string;
      weightPercent?: number;
      gradingPolicy?: string;
    }>();
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.weightPercent !== undefined) patch.weightPercent = body.weightPercent;
    if (body.gradingPolicy !== undefined) patch.gradingPolicy = body.gradingPolicy;
    const [row] = await db
      .update(schoolAssignmentCategories)
      .set(patch)
      .where(eq(schoolAssignmentCategories.id, categoryId))
      .returning();
    return c.json({ category: row });
  });

  app.delete("/categories/:categoryId", async (c) => {
    const auth = c.get("auth")!;
    const categoryId = c.req.param("categoryId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [existing] = await db
      .select({ id: schoolAssignmentCategories.id, classId: schoolAssignmentCategories.classId })
      .from(schoolAssignmentCategories)
      .where(eq(schoolAssignmentCategories.id, categoryId))
      .limit(1);
    if (!existing?.classId || !(await classForHousehold(db, existing.classId, auth.householdId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(eq(schoolClasses.id, existing.classId))
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, existing.classId),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEditCategories) return c.json({ error: "forbidden" }, 403);
    await db.delete(schoolAssignmentCategories).where(eq(schoolAssignmentCategories.id, categoryId));
    return c.json({ ok: true });
  });

  app.post("/classes/:classId/assignments", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, classId),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEditAssignments) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{
      title: string;
      instructionsHtml?: string;
      dueAt?: string;
      pointsPossible?: number;
      visibility?: "draft" | "assigned" | "closed";
      categoryId?: string | null;
      allowLate?: boolean;
      maxAttempts?: number | null;
    }>();
    const [row] = await db
      .insert(schoolAssignments)
      .values({
        classId,
        title: body.title,
        instructionsHtml: body.instructionsHtml ?? "",
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        pointsPossible: body.pointsPossible ?? 100,
        visibility: body.visibility ?? "assigned",
        categoryId: body.categoryId ?? null,
        allowLate: body.allowLate ?? true,
        maxAttempts: body.maxAttempts ?? null,
        createdByUserId: auth.userId,
      })
      .returning();
    return c.json({ assignment: row }, 201);
  });

  app.get("/assignments/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [row] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, id))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, row.classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);

    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
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
    if (!visibleIds.includes(cls.id)) return c.json({ error: "not_found" }, 404);

    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });

    return c.json({
      assignment: row,
      class: cls,
      access,
      context,
      materials: await loadAssignmentMaterials(db, id, access),
    });
  });

  app.patch("/assignments/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, id))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEditAssignments) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{
      title?: string;
      instructionsHtml?: string;
      dueAt?: string | null;
      pointsPossible?: number;
      visibility?: "draft" | "assigned" | "closed";
      categoryId?: string | null;
      allowLate?: boolean;
      maxAttempts?: number | null;
    }>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.instructionsHtml !== undefined) patch.instructionsHtml = body.instructionsHtml;
    if (body.dueAt !== undefined) patch.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    if (body.pointsPossible !== undefined) patch.pointsPossible = body.pointsPossible;
    if (body.visibility !== undefined) patch.visibility = body.visibility;
    if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
    if (body.allowLate !== undefined) patch.allowLate = body.allowLate;
    if (body.maxAttempts !== undefined) patch.maxAttempts = body.maxAttempts;
    const [row] = await db
      .update(schoolAssignments)
      .set(patch)
      .where(eq(schoolAssignments.id, id))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ assignment: row });
  });

  app.delete("/assignments/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, id))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEditAssignments) return c.json({ error: "forbidden" }, 403);
    await db.delete(schoolAssignments).where(eq(schoolAssignments.id, id));
    return c.json({ ok: true });
  });

  app.post("/assignments/:id/duplicate", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, id))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canEditAssignments) return c.json({ error: "forbidden" }, 403);
    const [row] = await db
      .insert(schoolAssignments)
      .values({
        classId: assignmentRow.classId,
        categoryId: assignmentRow.categoryId,
        title: `${assignmentRow.title} (copy)`.slice(0, 256),
        instructionsHtml: assignmentRow.instructionsHtml ?? "",
        dueAt: assignmentRow.dueAt,
        pointsPossible: assignmentRow.pointsPossible,
        allowLate: assignmentRow.allowLate,
        maxAttempts: assignmentRow.maxAttempts,
        visibility: "draft",
        createdByUserId: auth.userId,
      })
      .returning();
    if (row) {
      const sourceMaterials = await db
        .select()
        .from(schoolAssignmentMaterials)
        .where(eq(schoolAssignmentMaterials.assignmentId, id));
      for (const m of sourceMaterials) {
        const [newMat] = await db
          .insert(schoolAssignmentMaterials)
          .values({
            assignmentId: row.id,
            role: m.role,
            source: m.source,
            displayName: m.displayName,
            sortOrder: m.sortOrder,
            driveObjectId: m.driveObjectId,
            externalUrl: m.externalUrl,
            googleFileId: m.googleFileId,
            googleMimeType: m.googleMimeType,
            googleRevisionId: m.googleRevisionId,
            isTest: m.isTest,
            strictContentCheck: m.strictContentCheck,
            studentVisible: m.studentVisible,
            observerVisible: m.observerVisible,
            nativeTestPointsMode: m.nativeTestPointsMode,
            createdByUserId: auth.userId,
          })
          .returning();
        if (!newMat || m.source !== "native_test") continue;
        const questions = await db
          .select()
          .from(schoolTestQuestions)
          .where(eq(schoolTestQuestions.materialId, m.id))
          .orderBy(asc(schoolTestQuestions.sortOrder));
        if (questions.length === 0) continue;
        await db.insert(schoolTestQuestions).values(
          questions.map((q) => ({
            materialId: newMat.id,
            sortOrder: q.sortOrder,
            questionType: q.questionType,
            promptMarkdown: q.promptMarkdown,
            points: q.points,
            weight: q.weight,
            optionsJson: q.optionsJson,
            correctAnswerJson: q.correctAnswerJson,
          })),
        );
      }
    }
    return c.json({ assignment: row }, 201);
  });

  app.get("/assignments/:id/submissions", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, id))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });

    let subs = await db
      .select()
      .from(schoolSubmissions)
      .where(eq(schoolSubmissions.assignmentId, id));

    if (access.viewMode === "student") {
      subs = subs.filter((s) => s.studentMemberId === context.memberId);
    }
    const memberIds = [...new Set(subs.map((s) => s.studentMemberId))];
    const memberRows =
      memberIds.length === 0
        ? []
        : await db
            .select({
              id: householdMembers.id,
              name: householdMembers.name,
              legacyDisplayName: householdMembers.legacyDisplayName,
              email: users.email,
            })
            .from(householdMembers)
            .innerJoin(users, eq(householdMembers.userId, users.id))
            .where(inArray(householdMembers.id, memberIds));
    const memberLabels = new Map(memberRows.map((m) => [m.id, memberShownLabel(m)]));

    const withGrades = await Promise.all(
      subs.map(async (s) => {
        const [grade] = await db
          .select()
          .from(schoolGrades)
          .where(eq(schoolGrades.submissionId, s.id))
          .limit(1);
        const artifacts = await db
          .select()
          .from(schoolSubmissionArtifacts)
          .where(eq(schoolSubmissionArtifacts.submissionId, s.id));
        return {
          ...s,
          studentLabel: memberLabels.get(s.studentMemberId) ?? "Student",
          grade: grade ?? null,
          artifacts: artifacts.map(serializeSubmissionArtifact),
        };
      }),
    );
    return c.json({ submissions: withGrades, access });
  });

  app.post("/assignments/:id/submit", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const body = await c.req.json<{ studentMemberId?: string; studentNote?: string }>();
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, assignmentId))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canSubmit) return c.json({ error: "forbidden" }, 403);
    const studentMemberId = body.studentMemberId ?? context.memberId;

    const [existing] = await db
      .select()
      .from(schoolSubmissions)
      .where(
        and(
          eq(schoolSubmissions.assignmentId, assignmentId),
          eq(schoolSubmissions.studentMemberId, studentMemberId),
        ),
      )
      .limit(1);

    if (
      isAttemptsExhausted(assignmentRow.maxAttempts, existing?.turnInCount ?? 0)
    ) {
      return c.json({ error: "attempts_exhausted" }, 403);
    }

    const now = new Date();
    const pastDueCheck = canSubmitPastDue({
      dueAt: assignmentRow.dueAt,
      allowLate: assignmentRow.allowLate,
      now,
      existingStatus: existing?.status ?? null,
    });
    if (!pastDueCheck.allowed) {
      return c.json({ error: pastDueCheck.error }, 403);
    }

    const isLate = isSubmissionLate(assignmentRow.dueAt, now);
    let submissionRow: typeof schoolSubmissions.$inferSelect;
    if (existing) {
      const [updated] = await db
        .update(schoolSubmissions)
        .set({
          status: "submitted",
          submittedAt: now,
          isLate,
          studentNote: body.studentNote ?? existing.studentNote,
          turnInCount: existing.turnInCount + 1,
          updatedAt: now,
        })
        .where(eq(schoolSubmissions.id, existing.id))
        .returning();
      submissionRow = updated!;
    } else {
      const [created] = await db
        .insert(schoolSubmissions)
        .values({
          assignmentId,
          studentMemberId,
          status: "submitted",
          submittedAt: now,
          isLate,
          studentNote: body.studentNote ?? "",
          turnInCount: 1,
        })
        .returning();
      submissionRow = created!;
    }

    const autoGrade = await applyNativeTestAutoGrade(db, {
      submissionId: submissionRow.id,
      assignmentId,
      turnInNumber: submissionRow.turnInCount,
      gradedByUserId: auth.userId,
    });

    const [{ count: submissionCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schoolSubmissions)
      .where(
        and(
          eq(schoolSubmissions.assignmentId, assignmentId),
          ne(schoolSubmissions.status, "not_started"),
        ),
      );
    if (submissionCount === 1) {
      try {
        await freezeAssignmentTestMaterials(db, env, assignmentId);
      } catch (e) {
        if (e instanceof SchoolMaterialFreezeError) {
          const status = e.code === "material_freeze_failed" ? 502 : 403;
          return c.json({ error: e.code, message: e.message }, status);
        }
        throw e;
      }
    }

    const [freshSubmission] = await db
      .select()
      .from(schoolSubmissions)
      .where(eq(schoolSubmissions.id, submissionRow.id))
      .limit(1);
    const [grade] = await db
      .select()
      .from(schoolGrades)
      .where(eq(schoolGrades.submissionId, submissionRow.id))
      .limit(1);

    return c.json({
      submission: freshSubmission ?? submissionRow,
      grade: grade ?? null,
      needsManualGrade: autoGrade.needsManualGrade,
      autoScore: autoGrade.score,
      attemptsRemaining: attemptsRemaining(
        assignmentRow.maxAttempts,
        (freshSubmission ?? submissionRow).turnInCount,
      ),
    });
  });

  app.post("/assignments/:id/submissions/ensure", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, assignmentId))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canSubmit) return c.json({ error: "forbidden" }, 403);

    const [existing] = await db
      .select()
      .from(schoolSubmissions)
      .where(
        and(
          eq(schoolSubmissions.assignmentId, assignmentId),
          eq(schoolSubmissions.studentMemberId, context.memberId),
        ),
      )
      .limit(1);
    if (existing) {
      return c.json({ submission: existing });
    }

    const [created] = await db
      .insert(schoolSubmissions)
      .values({
        assignmentId,
        studentMemberId: context.memberId,
        status: "not_started",
        turnInCount: 0,
      })
      .returning();
    return c.json({ submission: created }, 201);
  });

  app.post("/submissions/:id/artifacts", async (c) => {
    const auth = c.get("auth")!;
    const submissionId = c.req.param("id");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);

    const subCtx = await submissionAccessForAuth(db, auth, submissionId, {
      memberId: context.memberId,
      householdRole: context.householdRole,
    });
    if (!subCtx) return c.json({ error: "not_found" }, 404);
    if (!canModifySubmissionArtifacts(subCtx)) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json<{
      artifactType: string;
      s3Key?: string;
      url?: string;
      note?: string;
    }>();
    const [art] = await db
      .insert(schoolSubmissionArtifacts)
      .values({
        submissionId,
        artifactType: body.artifactType ?? "file",
        s3Key: body.s3Key,
        url: body.url,
        note: body.note ?? "",
      })
      .returning();
    return c.json({ artifact: serializeSubmissionArtifact(art!) }, 201);
  });

  app.get("/artifacts/:id/file", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);

    const [artifact] = await db
      .select()
      .from(schoolSubmissionArtifacts)
      .where(eq(schoolSubmissionArtifacts.id, id))
      .limit(1);
    if (!artifact) return c.json({ error: "not_found" }, 404);

    const [submission] = await db
      .select()
      .from(schoolSubmissions)
      .where(eq(schoolSubmissions.id, artifact.submissionId))
      .limit(1);
    if (!submission) return c.json({ error: "not_found" }, 404);

    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, submission.assignmentId))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);

    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);

    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    const canView =
      access.canGrade ||
      access.canViewFullGradebook ||
      (access.canSubmit && submission.studentMemberId === context.memberId);
    if (!canView) return c.json({ error: "forbidden" }, 403);

    if (artifact.artifactType === "google_doc" && artifact.googleFileId) {
      const openUrl = googleFileWebUrl(artifact.googleFileId, artifact.googleMimeType);
      return c.redirect(openUrl);
    }

    if (artifact.url && !artifact.s3Key) {
      return c.redirect(artifact.url);
    }
    if (!artifact.s3Key) return c.json({ error: "not_found" }, 404);

    const buf = await getObjectBuffer(env, artifact.s3Key);
    if (!buf) return c.json({ error: "storage_unavailable" }, 503);

    const filename = artifact.s3Key.split("/").pop()?.replace(/^\d+-/, "") ?? "download";
    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": contentTypeFromKey(artifact.s3Key),
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    });
  });

  app.delete("/artifacts/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);

    const [artifact] = await db
      .select()
      .from(schoolSubmissionArtifacts)
      .where(eq(schoolSubmissionArtifacts.id, id))
      .limit(1);
    if (!artifact) return c.json({ error: "not_found" }, 404);

    const subCtx = await submissionAccessForAuth(db, auth, artifact.submissionId, {
      memberId: context.memberId,
      householdRole: context.householdRole,
    });
    if (!subCtx) return c.json({ error: "not_found" }, 404);
    if (!canModifySubmissionArtifacts(subCtx)) return c.json({ error: "forbidden" }, 403);

    await db.delete(schoolSubmissionArtifacts).where(eq(schoolSubmissionArtifacts.id, id));
    return c.json({ ok: true });
  });

  app.get("/assignments/:id/google-readiness", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);

    const materialRows = await db
      .select()
      .from(schoolAssignmentMaterials)
      .where(eq(schoolAssignmentMaterials.assignmentId, assignmentId));
    const visible = materialRows.filter((row) =>
      materialVisibleToViewer(row, ctx.access.viewMode),
    );
    const needsGoogle = assignmentNeedsGoogleConnection(visible, ctx.access.viewMode);
    const conn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
    const returnPath = `/school/assignment/${assignmentId}`;
    const connectUrl = `/auth/google/docs/start?next=${encodeURIComponent(returnPath)}`;

    return c.json({
      needsGoogle,
      connected: Boolean(conn),
      connectUrl,
    });
  });

  app.get("/assignments/:id/google-copies", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canSubmit) return c.json({ error: "forbidden" }, 403);

    const [submission] = await db
      .select()
      .from(schoolSubmissions)
      .where(
        and(
          eq(schoolSubmissions.assignmentId, assignmentId),
          eq(schoolSubmissions.studentMemberId, ctx.context.memberId),
        ),
      )
      .limit(1);
    if (!submission) return c.json({ copies: [] });

    const copies = await db
      .select()
      .from(schoolSubmissionGoogleCopies)
      .where(eq(schoolSubmissionGoogleCopies.submissionId, submission.id));

    return c.json({
      copies: copies.map((copy) => ({
        id: copy.id,
        materialId: copy.materialId,
        studentGoogleFileId: copy.studentGoogleFileId,
        studentGoogleMimeType: copy.studentGoogleMimeType,
        openUrl: googleFileWebUrl(copy.studentGoogleFileId, copy.studentGoogleMimeType),
        copiedAt: copy.copiedAt.toISOString(),
      })),
    });
  });

  app.post("/assignments/:assignmentId/materials/:materialId/start-copy", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("assignmentId");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canSubmit) return c.json({ error: "forbidden" }, 403);

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
    if (!material) return c.json({ error: "not_found" }, 404);
    if (!materialVisibleToViewer(material, ctx.access.viewMode)) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (material.source !== "google_doc" || !material.isTest) {
      return c.json({ error: "invalid_material" }, 400);
    }
    if (material.frozenAt) return c.json({ error: "material_frozen" }, 409);

    let [submission] = await db
      .select()
      .from(schoolSubmissions)
      .where(
        and(
          eq(schoolSubmissions.assignmentId, assignmentId),
          eq(schoolSubmissions.studentMemberId, ctx.context.memberId),
        ),
      )
      .limit(1);
    if (!submission) {
      const [created] = await db
        .insert(schoolSubmissions)
        .values({
          assignmentId,
          studentMemberId: ctx.context.memberId,
          status: "not_started",
          turnInCount: 0,
        })
        .returning();
      submission = created!;
    }

    try {
      const result = await ensureGoogleStudentCopy(db, env, {
        householdId: auth.householdId,
        studentUserId: auth.userId,
        submissionId: submission.id,
        material,
      });
      return c.json({
        copy: {
          id: result.copy.id,
          materialId: result.copy.materialId,
          studentGoogleFileId: result.copy.studentGoogleFileId,
          studentGoogleMimeType: result.copy.studentGoogleMimeType,
          openUrl: result.openUrl,
          copiedAt: result.copy.copiedAt.toISOString(),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "copy_failed";
      if (message === "google_docs_not_connected" || message === "google_docs_token_revoked") {
        return c.json({ error: message }, 403);
      }
      if (message === "google_account_email_required") {
        return c.json({ error: message }, 400);
      }
      if (message === "teacher_google_docs_not_connected") {
        return c.json(
          { error: message, detail: "Teacher must reconnect Google Docs" },
          502,
        );
      }
      if (message === "material_missing_google_file" || message === "material_missing_teacher") {
        return c.json({ error: message }, 400);
      }
      console.error("start-copy failed", e);
      return c.json({ error: "template_not_accessible" }, 502);
    }
  });

  app.post("/submissions/:submissionId/google-artifacts", async (c) => {
    const auth = c.get("auth")!;
    const submissionId = c.req.param("submissionId");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);

    const subCtx = await submissionAccessForAuth(db, auth, submissionId, {
      memberId: context.memberId,
      householdRole: context.householdRole,
    });
    if (!subCtx) return c.json({ error: "not_found" }, 404);
    if (!canModifySubmissionArtifacts(subCtx)) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json<{
      materialId?: string;
      googleFileId?: string;
      googleMimeType?: string | null;
    }>();
    if (!body.googleFileId?.trim()) {
      return c.json({ error: "google_file_required" }, 400);
    }

    const studentConn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
    if (!studentConn) return c.json({ error: "google_docs_not_connected" }, 403);

    let studentToken: string;
    try {
      studentToken = await ensureGoogleDocsAccessToken(db, env, studentConn);
    } catch (e) {
      if (e instanceof GoogleDocsCredentialsError) {
        return c.json({ error: "google_docs_token_revoked", message: e.message }, 403);
      }
      throw e;
    }

    const meta = await fetchGoogleDriveFileMetadata(studentToken, body.googleFileId.trim());
    if (!meta) return c.json({ error: "google_file_inaccessible" }, 404);

    let copyRow: typeof schoolSubmissionGoogleCopies.$inferSelect | null = null;
    let material: typeof schoolAssignmentMaterials.$inferSelect | null = null;
    if (body.materialId) {
      [material] = await db
        .select()
        .from(schoolAssignmentMaterials)
        .where(
          and(
            eq(schoolAssignmentMaterials.id, body.materialId),
            eq(schoolAssignmentMaterials.assignmentId, subCtx.submission.assignmentId),
          ),
        )
        .limit(1);
      if (!material) return c.json({ error: "material_not_found" }, 404);

      const [copy] = await db
        .select()
        .from(schoolSubmissionGoogleCopies)
        .where(
          and(
            eq(schoolSubmissionGoogleCopies.submissionId, submissionId),
            eq(schoolSubmissionGoogleCopies.materialId, body.materialId),
          ),
        )
        .limit(1);
      copyRow = copy ?? null;
    }

    const lineage = material
      ? await runGoogleLineageChecks(db, env, {
          householdId: auth.householdId,
          material,
          pickedFileId: body.googleFileId.trim(),
          pickedMimeType: body.googleMimeType ?? meta.mimeType,
          copyRow,
          appProperties: meta.appProperties ?? null,
          studentAccessToken: studentToken,
        })
      : verifyGoogleSubmissionLineage({
          pickedFileId: body.googleFileId.trim(),
          copyRow: copyRow
            ? {
                studentGoogleFileId: copyRow.studentGoogleFileId,
                materialId: copyRow.materialId,
                templateGoogleFileId: copyRow.templateGoogleFileId,
              }
            : null,
          appProperties: meta.appProperties ?? null,
        });

    const [art] = await db
      .insert(schoolSubmissionArtifacts)
      .values({
        submissionId,
        artifactType: "google_doc",
        googleFileId: body.googleFileId.trim(),
        googleMimeType: body.googleMimeType ?? meta.mimeType,
        googleRevisionId: meta.headRevisionId ?? null,
        materialId: body.materialId ?? null,
        lineageStatus: lineage.status,
        lineageDetail: lineage.detail,
      })
      .returning();

    return c.json({ artifact: serializeSubmissionArtifact(art!) }, 201);
  });

  app.post("/submissions/:id/grade", async (c) => {
    const auth = c.get("auth")!;
    const submissionId = c.req.param("id");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [submission] = await db
      .select()
      .from(schoolSubmissions)
      .where(eq(schoolSubmissions.id, submissionId))
      .limit(1);
    if (!submission) return c.json({ error: "not_found" }, 404);
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, submission.assignmentId))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canGrade) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{
      score?: number | null;
      feedbackHtml?: string;
      revisionRequested?: boolean;
    }>();
    const [existing] = await db
      .select()
      .from(schoolGrades)
      .where(eq(schoolGrades.submissionId, submissionId))
      .limit(1);
    if (existing) {
      const [grade] = await db
        .update(schoolGrades)
        .set({
          score: body.score ?? existing.score,
          feedbackHtml: body.feedbackHtml ?? existing.feedbackHtml,
          revisionRequested: body.revisionRequested ?? existing.revisionRequested,
          gradedByUserId: auth.userId,
          gradedAt: new Date(),
        })
        .where(eq(schoolGrades.id, existing.id))
        .returning();
      await db
        .update(schoolSubmissions)
        .set({ status: "graded", updatedAt: new Date() })
        .where(eq(schoolSubmissions.id, submissionId));
      return c.json({ grade });
    }
    const [grade] = await db
      .insert(schoolGrades)
      .values({
        submissionId,
        score: body.score ?? null,
        feedbackHtml: body.feedbackHtml ?? "",
        revisionRequested: body.revisionRequested ?? false,
        gradedByUserId: auth.userId,
        gradedAt: new Date(),
      })
      .returning();
    await db
      .update(schoolSubmissions)
      .set({ status: "graded", updatedAt: new Date() })
      .where(eq(schoolSubmissions.id, submissionId));
    return c.json({ grade }, 201);
  });

  app.get("/submissions/:id/test-review", async (c) => {
    const auth = c.get("auth")!;
    const submissionId = c.req.param("id");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [submissionRow] = await db
      .select()
      .from(schoolSubmissions)
      .where(eq(schoolSubmissions.id, submissionId))
      .limit(1);
    if (!submissionRow) return c.json({ error: "not_found" }, 404);
    let submission = submissionRow;
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, submission.assignmentId))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canGrade) return c.json({ error: "forbidden" }, 403);

    const turnInNumber = Math.max(1, submission.turnInCount);

    // Recompute auto-scores on review so scale/points_possible changes apply
    // (e.g. WHO-220 explicit→assignment total). Preserve teacher manual overrides.
    if (submission.turnInCount > 0) {
      const nativeMaterials = await db
        .select({ id: schoolAssignmentMaterials.id })
        .from(schoolAssignmentMaterials)
        .where(
          and(
            eq(schoolAssignmentMaterials.assignmentId, assignmentRow.id),
            eq(schoolAssignmentMaterials.source, "native_test"),
          ),
        );
      if (nativeMaterials.length > 0) {
        await applyNativeTestAutoGrade(db, {
          submissionId,
          assignmentId: assignmentRow.id,
          turnInNumber,
          gradedByUserId: auth.userId,
          preserveManualScores: true,
        });
        const [refreshed] = await db
          .select()
          .from(schoolSubmissions)
          .where(eq(schoolSubmissions.id, submissionId))
          .limit(1);
        if (refreshed) submission = refreshed;
      }
    }

    const materials = await db
      .select()
      .from(schoolAssignmentMaterials)
      .where(
        and(
          eq(schoolAssignmentMaterials.assignmentId, assignmentRow.id),
          eq(schoolAssignmentMaterials.source, "native_test"),
        ),
      )
      .orderBy(asc(schoolAssignmentMaterials.sortOrder));

    const [memberRow] = await db
      .select({
        id: householdMembers.id,
        name: householdMembers.name,
        legacyDisplayName: householdMembers.legacyDisplayName,
        email: users.email,
      })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.id, submission.studentMemberId))
      .limit(1);

    const [grade] = await db
      .select()
      .from(schoolGrades)
      .where(eq(schoolGrades.submissionId, submissionId))
      .limit(1);

    const materialReviews = [];
    let needsManualGrade = false;
    let earnedTotal = 0;
    let maxTotal = 0;
    let pendingManual = 0;

    for (const material of materials) {
      const pointsMode = (material.nativeTestPointsMode ?? "explicit") as SchoolNativeTestPointsMode;
      const questions = await db
        .select()
        .from(schoolTestQuestions)
        .where(eq(schoolTestQuestions.materialId, material.id))
        .orderBy(asc(schoolTestQuestions.sortOrder));
      const responses = await db
        .select()
        .from(schoolSubmissionResponses)
        .where(
          and(
            eq(schoolSubmissionResponses.submissionId, submissionId),
            eq(schoolSubmissionResponses.materialId, material.id),
            eq(schoolSubmissionResponses.turnInNumber, turnInNumber),
          ),
        );
      const byQuestion = new Map(responses.map((r) => [r.questionId, r]));
      const gradable = questions.map((q) => ({
        id: q.id,
        questionType: q.questionType as SchoolQuestionType,
        points: q.points,
        weight: q.weight,
        correctAnswerJson: q.correctAnswerJson,
      }));

      const questionReviews = questions.map((q) => {
        const response = byQuestion.get(q.id);
        const maxPoints = reviewQuestionMaxPoints(
          {
            id: q.id,
            questionType: q.questionType as SchoolQuestionType,
            points: q.points,
            weight: q.weight,
            correctAnswerJson: q.correctAnswerJson,
          },
          pointsMode,
          assignmentRow.pointsPossible,
          gradable,
        );
        const autoScore = response?.autoScore ?? null;
        const manualScore = response?.manualScore ?? null;
        const effective = effectiveQuestionScore({ autoScore, manualScore });
        const isLong = q.questionType === "long_answer";
        const needsManual = isLong && effective == null;
        if (needsManual) {
          needsManualGrade = true;
          pendingManual += 1;
        }
        maxTotal += maxPoints;
        if (effective != null) earnedTotal += effective;
        return {
          question: serializeQuestionStaff(q),
          maxPoints,
          responseJson: response?.responseJson ?? {},
          autoScore,
          manualScore,
          effectiveScore: effective,
          needsManualGrade: needsManual,
          gradedAt: response?.gradedAt?.toISOString() ?? null,
        };
      });

      materialReviews.push({
        materialId: material.id,
        displayName: material.displayName,
        pointsMode,
        questions: questionReviews,
      });
    }

    return c.json({
      submission: {
        id: submission.id,
        status: submission.status,
        studentMemberId: submission.studentMemberId,
        studentLabel: memberRow ? memberShownLabel(memberRow) : "Student",
        turnInCount: submission.turnInCount,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
      },
      turnInNumber,
      grade: grade ?? null,
      needsManualGrade,
      pendingManualCount: pendingManual,
      earnedTotal: Math.round(earnedTotal * 1000) / 1000,
      maxTotal: Math.round(maxTotal * 1000) / 1000,
      materials: materialReviews,
      access,
    });
  });

  app.post("/submissions/:id/grade-question", async (c) => {
    const auth = c.get("auth")!;
    const submissionId = c.req.param("id");
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    const [submission] = await db
      .select()
      .from(schoolSubmissions)
      .where(eq(schoolSubmissions.id, submissionId))
      .limit(1);
    if (!submission) return c.json({ error: "not_found" }, 404);
    const [assignmentRow] = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.id, submission.assignmentId))
      .limit(1);
    if (!assignmentRow) return c.json({ error: "not_found" }, 404);
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(
        and(eq(schoolClasses.id, assignmentRow.classId), eq(schoolClasses.householdId, auth.householdId)),
      )
      .limit(1);
    if (!cls) return c.json({ error: "not_found" }, 404);
    const [myEnrollment] = await db
      .select()
      .from(schoolEnrollments)
      .where(
        and(
          eq(schoolEnrollments.classId, cls.id),
          eq(schoolEnrollments.memberId, context.memberId),
        ),
      )
      .limit(1);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: myEnrollment ?? null,
    });
    if (!access.canGrade) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json<{
      questionId?: string;
      manualScore?: number | null;
      turnInNumber?: number;
    }>();
    if (!body.questionId) return c.json({ error: "question_id_required" }, 400);
    if (body.manualScore != null && (typeof body.manualScore !== "number" || Number.isNaN(body.manualScore))) {
      return c.json({ error: "invalid_score" }, 400);
    }
    if (body.manualScore != null && body.manualScore < 0) {
      return c.json({ error: "invalid_score" }, 400);
    }

    const [question] = await db
      .select()
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.id, body.questionId))
      .limit(1);
    if (!question) return c.json({ error: "not_found" }, 404);

    const [material] = await db
      .select()
      .from(schoolAssignmentMaterials)
      .where(
        and(
          eq(schoolAssignmentMaterials.id, question.materialId),
          eq(schoolAssignmentMaterials.assignmentId, assignmentRow.id),
          eq(schoolAssignmentMaterials.source, "native_test"),
        ),
      )
      .limit(1);
    if (!material) return c.json({ error: "not_found" }, 404);

    const turnInNumber = body.turnInNumber ?? Math.max(1, submission.turnInCount);
    const now = new Date();
    const [existing] = await db
      .select()
      .from(schoolSubmissionResponses)
      .where(
        and(
          eq(schoolSubmissionResponses.submissionId, submissionId),
          eq(schoolSubmissionResponses.questionId, body.questionId),
          eq(schoolSubmissionResponses.turnInNumber, turnInNumber),
        ),
      )
      .limit(1);

    let responseRow: typeof schoolSubmissionResponses.$inferSelect;
    if (existing) {
      const [updated] = await db
        .update(schoolSubmissionResponses)
        .set({
          manualScore: body.manualScore ?? null,
          gradedByUserId: auth.userId,
          gradedAt: now,
          updatedAt: now,
        })
        .where(eq(schoolSubmissionResponses.id, existing.id))
        .returning();
      responseRow = updated!;
    } else {
      const [created] = await db
        .insert(schoolSubmissionResponses)
        .values({
          submissionId,
          materialId: material.id,
          questionId: body.questionId,
          turnInNumber,
          responseJson: {},
          autoScore: null,
          manualScore: body.manualScore ?? null,
          gradedByUserId: auth.userId,
          gradedAt: now,
        })
        .returning();
      responseRow = created!;
    }

    const rollup = await recomputeNativeTestRollup(db, {
      submissionId,
      assignmentId: assignmentRow.id,
      turnInNumber,
      gradedByUserId: auth.userId,
    });

    const [grade] = await db
      .select()
      .from(schoolGrades)
      .where(eq(schoolGrades.submissionId, submissionId))
      .limit(1);

    return c.json({
      response: {
        questionId: responseRow.questionId,
        autoScore: responseRow.autoScore,
        manualScore: responseRow.manualScore,
        effectiveScore: effectiveQuestionScore({
          autoScore: responseRow.autoScore,
          manualScore: responseRow.manualScore,
        }),
      },
      rollup,
      grade: grade ?? null,
    });
  });

  app.get("/assignments/:id/materials", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const ctx = await assignmentAccessForAuth(db, auth, id);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    const materials = await loadAssignmentMaterials(db, id, ctx.access);
    return c.json({ materials, access: ctx.access });
  });

  app.post("/assignments/:id/materials", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const ctx = await assignmentAccessForAuth(db, auth, id);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canEditAssignments) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json<{
      role?: string;
      source?: string;
      displayName?: string;
      sortOrder?: number;
      driveObjectId?: string | null;
      externalUrl?: string | null;
      googleFileId?: string | null;
      googleMimeType?: string | null;
      googleRevisionId?: string | null;
      isTest?: boolean;
      strictContentCheck?: boolean;
      nativeTestPointsMode?: SchoolNativeTestPointsMode;
      studentVisible?: boolean;
      observerVisible?: boolean;
    }>();

    let source = body.source as SchoolMaterialSource | undefined;
    let externalUrl = body.externalUrl ?? null;
    let googleFileId = body.googleFileId?.trim() ?? null;
    let googleMimeType = body.googleMimeType?.trim() ?? null;
    let googleRevisionId = body.googleRevisionId?.trim() ?? null;
    let displayName = body.displayName;

    if (body.driveObjectId) {
      const resolved = await resolveDriveSource(db, auth.householdId, body.driveObjectId);
      if (!resolved) return c.json({ error: "drive_object_not_found" }, 404);
      source = resolved.source;
      if (resolved.externalUrl) externalUrl = resolved.externalUrl;
    }

    if (source === "native_test") {
      if (!displayName?.trim()) displayName = "In-app test";
    } else if (source === "google_doc" || googleFileId) {
      source = "google_doc";
      if (!googleFileId) return c.json({ error: "google_file_required" }, 400);

      const conn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
      if (!conn) return c.json({ error: "google_docs_not_connected" }, 403);

      let accessToken: string;
      try {
        accessToken = await ensureGoogleDocsAccessToken(db, env, conn);
      } catch (e) {
        if (e instanceof GoogleDocsCredentialsError) {
          return c.json({ error: "google_docs_token_revoked", message: e.message }, 403);
        }
        throw e;
      }

      let meta;
      try {
        meta = await fetchGoogleDriveFileMetadata(accessToken, googleFileId);
      } catch {
        return c.json({ error: "google_file_inaccessible" }, 502);
      }
      if (!meta) return c.json({ error: "google_file_inaccessible" }, 404);
      if (meta.mimeType === GOOGLE_FORMS_MIME) {
        return c.json({ error: "google_forms_not_supported" }, 400);
      }

      googleMimeType = meta.mimeType;
      googleRevisionId = meta.headRevisionId ?? googleRevisionId;
      if (!displayName?.trim()) displayName = meta.name;
    }

    const validated = validateMaterialInput(
      {
        role: body.role as Parameters<typeof validateMaterialInput>[0]["role"],
        source,
        displayName,
        sortOrder: body.sortOrder,
        driveObjectId: body.driveObjectId,
        externalUrl,
        googleFileId,
        googleMimeType,
        isTest: body.isTest,
        strictContentCheck: body.strictContentCheck,
        studentVisible: body.studentVisible,
        observerVisible: body.observerVisible,
      },
      { isCreate: true },
    );
    if (!validated.ok) return c.json({ error: validated.error }, 400);

    const [row] = await db
      .insert(schoolAssignmentMaterials)
      .values({
        assignmentId: id,
        role: validated.value.role,
        source: validated.value.source,
        displayName: validated.value.displayName,
        sortOrder: validated.value.sortOrder ?? 0,
        driveObjectId: body.driveObjectId ?? null,
        externalUrl:
          validated.value.source === "external_url" || validated.value.source === "domi_drive_link"
            ? externalUrl
            : null,
        googleFileId: validated.value.source === "google_doc" ? googleFileId : null,
        googleMimeType: validated.value.source === "google_doc" ? googleMimeType : null,
        googleRevisionId: validated.value.source === "google_doc" ? googleRevisionId : null,
        isTest: validated.value.isTest ?? (validated.value.source === "native_test"),
        strictContentCheck: body.strictContentCheck ?? false,
        nativeTestPointsMode:
          validated.value.source === "native_test"
            ? body.nativeTestPointsMode === "weighted"
              ? "weighted"
              : "explicit"
            : null,
        studentVisible: validated.value.studentVisible ?? true,
        observerVisible: validated.value.observerVisible ?? false,
        createdByUserId: auth.userId,
      })
      .returning();

    return c.json({ material: row }, 201);
  });

  app.patch("/assignments/:id/materials/:materialId", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canEditAssignments) return c.json({ error: "forbidden" }, 403);

    const [existing] = await db
      .select()
      .from(schoolAssignmentMaterials)
      .where(
        and(
          eq(schoolAssignmentMaterials.id, materialId),
          eq(schoolAssignmentMaterials.assignmentId, assignmentId),
        ),
      )
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (existing.frozenAt) return c.json({ error: "material_frozen" }, 409);

    const body = await c.req.json<{
      role?: string;
      displayName?: string;
      sortOrder?: number;
      externalUrl?: string | null;
      isTest?: boolean;
      strictContentCheck?: boolean;
      nativeTestPointsMode?: SchoolNativeTestPointsMode;
      studentVisible?: boolean;
      observerVisible?: boolean;
    }>();

    const validated = validateMaterialInput(
      {
        role: (body.role ?? existing.role) as Parameters<typeof validateMaterialInput>[0]["role"],
        source: existing.source,
        displayName: body.displayName ?? existing.displayName,
        sortOrder: body.sortOrder,
        isTest: body.isTest,
        studentVisible: body.studentVisible,
        observerVisible: body.observerVisible,
      },
      { isFrozen: Boolean(existing.frozenAt) },
    );
    if (!validated.ok) return c.json({ error: validated.error }, 400);

    const patch: Partial<typeof schoolAssignmentMaterials.$inferInsert> = {};
    if (body.displayName !== undefined) patch.displayName = validated.value.displayName;
    if (body.role !== undefined) patch.role = validated.value.role;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    if (body.isTest !== undefined) patch.isTest = body.isTest;
    if (body.strictContentCheck !== undefined) patch.strictContentCheck = body.strictContentCheck;
    if (body.nativeTestPointsMode !== undefined && existing.source === "native_test") {
      patch.nativeTestPointsMode =
        body.nativeTestPointsMode === "weighted" ? "weighted" : "explicit";
    }
    if (body.studentVisible !== undefined) patch.studentVisible = validated.value.studentVisible!;
    if (body.observerVisible !== undefined) patch.observerVisible = validated.value.observerVisible!;
    if (body.externalUrl !== undefined) patch.externalUrl = body.externalUrl;

    const [row] = await db
      .update(schoolAssignmentMaterials)
      .set(patch)
      .where(eq(schoolAssignmentMaterials.id, materialId))
      .returning();
    return c.json({ material: row });
  });

  app.delete("/assignments/:id/materials/:materialId", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canEditAssignments) return c.json({ error: "forbidden" }, 403);

    const [existing] = await db
      .select()
      .from(schoolAssignmentMaterials)
      .where(
        and(
          eq(schoolAssignmentMaterials.id, materialId),
          eq(schoolAssignmentMaterials.assignmentId, assignmentId),
        ),
      )
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (existing.frozenAt) return c.json({ error: "material_frozen" }, 409);

    await db.delete(schoolAssignmentMaterials).where(eq(schoolAssignmentMaterials.id, materialId));
    return c.json({ ok: true });
  });

  app.post("/assignments/:id/materials/:materialId/export-google-doc", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canEditAssignments) return c.json({ error: "forbidden" }, 403);

    const resolved = await staffNativeTestMaterial(
      db,
      assignmentId,
      materialId,
      ctx.access.canEditAssignments,
    );
    if ("error" in resolved) {
      const status = resolved.error === "forbidden" ? 403 : 404;
      return c.json({ error: resolved.error }, status);
    }

    const body = (await c.req.json().catch(() => ({}))) as { includeAnswerKey?: boolean };
    const includeAnswerKey = Boolean(body.includeAnswerKey);

    const conn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
    if (!conn) {
      return c.json(
        {
          error: "google_docs_not_connected",
          message: "Connect Google Docs in profile settings, then export again.",
        },
        403,
      );
    }

    let accessToken: string;
    try {
      accessToken = await ensureGoogleDocsAccessToken(db, env, conn);
    } catch (e) {
      if (e instanceof GoogleDocsCredentialsError) {
        return c.json({ error: "google_docs_token_revoked", message: e.message }, 403);
      }
      throw e;
    }

    const questions = await db
      .select()
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.materialId, materialId))
      .orderBy(asc(schoolTestQuestions.sortOrder), asc(schoolTestQuestions.createdAt));

    const exportQuestions = questions.map((q) => ({
      sortOrder: q.sortOrder,
      questionType: q.questionType as SchoolQuestionType,
      promptMarkdown: q.promptMarkdown,
      points: q.points,
      weight: q.weight,
      optionsJson: q.optionsJson,
      correctAnswerJson: q.correctAnswerJson,
    }));

    const title = `${ctx.assignment.title} — ${resolved.material.displayName}`;
    const plainText = formatNativeTestPlainText({
      assignmentTitle: ctx.assignment.title,
      testTitle: resolved.material.displayName,
      questions: exportQuestions,
      includeAnswerKey,
    });
    const html = formatNativeTestHtml({
      assignmentTitle: ctx.assignment.title,
      testTitle: resolved.material.displayName,
      questions: exportQuestions,
      includeAnswerKey,
    });

    try {
      const exported = await exportToGoogleDocs({
        accessToken,
        title,
        plainText,
        html,
        format: "styled",
      });
      return c.json({
        documentId: exported.documentId,
        url: exported.url,
        includeAnswerKey,
        questionCount: questions.length,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Google Docs export failed";
      return c.json({ error: "export_failed", message }, 502);
    }
  });

  app.post("/assignments/:id/materials/:materialId/convert-native-preview", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canEditAssignments) return c.json({ error: "forbidden" }, 403);

    const source = await loadConvertibleSourceMaterial(db, env, {
      householdId: auth.householdId,
      userId: auth.userId,
      assignmentId,
      materialId,
    });
    if ("error" in source) {
      const status =
        source.error === "google_docs_not_connected" || source.error === "google_docs_token_revoked"
          ? 403
          : source.error === "unsupported_source"
            ? 400
            : source.error === "empty_document"
              ? 422
              : source.error === "export_failed"
                ? 502
                : 404;
      return c.json({ error: source.error, message: source.message }, status);
    }

    const parsed = parseGoogleDocTestText(source.plainText);
    return c.json({
      sourceMaterial: {
        id: source.material.id,
        displayName: source.material.displayName,
        source: source.material.source,
        openUrl: source.openUrl,
      },
      questionCount: parsed.questions.length,
      warnings: parsed.warnings,
      questions: parsed.questions,
    });
  });

  app.post("/assignments/:id/materials/:materialId/convert-native", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canEditAssignments) return c.json({ error: "forbidden" }, 403);

    const [sourceMaterial] = await db
      .select()
      .from(schoolAssignmentMaterials)
      .where(
        and(
          eq(schoolAssignmentMaterials.id, materialId),
          eq(schoolAssignmentMaterials.assignmentId, assignmentId),
        ),
      )
      .limit(1);
    if (!sourceMaterial) return c.json({ error: "not_found" }, 404);
    if (
      sourceMaterial.source !== "google_doc" &&
      sourceMaterial.source !== "domi_drive_file" &&
      sourceMaterial.source !== "domi_drive_link"
    ) {
      return c.json({ error: "unsupported_source" }, 400);
    }

    const body = await c.req.json<{
      displayName?: string;
      pointsMode?: SchoolNativeTestPointsMode;
      questions?: ParsedImportQuestion[];
    }>();

    let questions = body.questions;
    if (!questions) {
      const source = await loadConvertibleSourceMaterial(db, env, {
        householdId: auth.householdId,
        userId: auth.userId,
        assignmentId,
        materialId,
      });
      if ("error" in source) {
        const status =
          source.error === "google_docs_not_connected" || source.error === "google_docs_token_revoked"
            ? 403
            : source.error === "empty_document"
              ? 422
              : source.error === "export_failed"
                ? 502
                : source.error === "unsupported_source"
                  ? 400
                  : 404;
        return c.json({ error: source.error, message: source.message }, status);
      }
      questions = parseGoogleDocTestText(source.plainText).questions;
    }
    if (questions.length === 0) {
      return c.json({ error: "no_questions", message: "No questions to import" }, 400);
    }

    const pointsMode: SchoolNativeTestPointsMode =
      body.pointsMode === "weighted" ? "weighted" : "explicit";
    const validated: Array<{
      questionType: SchoolQuestionType;
      promptMarkdown: string;
      points: number | null;
      weight: number | null;
      optionsJson: ParsedImportQuestion["optionsJson"];
      correctAnswerJson: Record<string, unknown> | null;
      sortOrder: number;
    }> = [];
    for (const [i, q] of questions.entries()) {
      const missingAutoGradeKey =
        q.questionType !== "long_answer" && q.correctAnswerJson == null;
      const safeQuestion: ParsedImportQuestion = missingAutoGradeKey
        ? {
            ...q,
            questionType: "long_answer",
            promptMarkdown: [
              q.promptMarkdown,
              ...(q.optionsJson?.length
                ? ["", "Imported options:", ...q.optionsJson.map((o) => `${o.id}) ${o.label}`)]
                : []),
            ].join("\n"),
            optionsJson: null,
            correctAnswerJson: null,
          }
        : q;
      const check = validateQuestionInput(
        {
          questionType: safeQuestion.questionType,
          promptMarkdown: safeQuestion.promptMarkdown,
          points: safeQuestion.points,
          weight: pointsMode === "weighted" ? safeQuestion.points : null,
          optionsJson: safeQuestion.optionsJson,
          correctAnswerJson: safeQuestion.correctAnswerJson,
          sortOrder: i,
        },
        { pointsMode, isCreate: true },
      );
      if (!check.ok) {
        return c.json(
          { error: "invalid_question", message: check.error, index: i },
          400,
        );
      }
      validated.push({
        questionType: check.value.questionType!,
        promptMarkdown: check.value.promptMarkdown!,
        points: check.value.points ?? null,
        weight: check.value.weight ?? null,
        optionsJson: check.value.optionsJson ?? null,
        correctAnswerJson: check.value.correctAnswerJson ?? null,
        sortOrder: i,
      });
    }

    const [{ maxSort }] = await db
      .select({
        maxSort: sql<number>`coalesce(max(${schoolAssignmentMaterials.sortOrder}), -1)::int`,
      })
      .from(schoolAssignmentMaterials)
      .where(eq(schoolAssignmentMaterials.assignmentId, assignmentId));

    const displayName =
      body.displayName?.trim() ||
      `${sourceMaterial.displayName.replace(/\s*\(import\)$/i, "")} (in-app)`;

    const created = await db.transaction(async (tx) => {
      const [material] = await tx
        .insert(schoolAssignmentMaterials)
        .values({
          assignmentId,
          role: "student_material",
          source: "native_test",
          displayName: displayName.slice(0, 256),
          sortOrder: (maxSort ?? -1) + 1,
          isTest: true,
          studentVisible: true,
          observerVisible: false,
          nativeTestPointsMode: pointsMode,
          createdByUserId: auth.userId,
        })
        .returning();

      await tx.insert(schoolTestQuestions).values(
        validated.map((v, i) => ({
          materialId: material!.id,
          sortOrder: i,
          questionType: v.questionType,
          promptMarkdown: v.promptMarkdown,
          points: v.points,
          weight: v.weight,
          optionsJson: v.optionsJson,
          correctAnswerJson: v.correctAnswerJson,
        })),
      );
      return material!;
    });

    return c.json(
      {
        material: serializeMaterial(created, { viewMode: "staff" }),
        questionCount: validated.length,
        sourceMaterialId: sourceMaterial.id,
        editUrl: `/school/assignment/${assignmentId}/materials/${created.id}/edit`,
      },
      201,
    );
  });

  app.get("/assignments/:id/materials/:materialId/questions", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);

    const resolved = await staffNativeTestMaterial(
      db,
      assignmentId,
      materialId,
      ctx.access.canEditAssignments,
    );
    if ("error" in resolved) {
      const status = resolved.error === "forbidden" ? 403 : 404;
      return c.json({ error: resolved.error }, status);
    }

    const questions = await db
      .select()
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.materialId, materialId))
      .orderBy(asc(schoolTestQuestions.sortOrder), asc(schoolTestQuestions.createdAt));

    return c.json({
      material: resolved.material,
      questions: questions.map(serializeQuestionStaff),
      frozen: Boolean(resolved.material.frozenAt),
    });
  });

  app.get("/assignments/:id/materials/:materialId/questions/preview", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);

    const resolved = await staffNativeTestMaterial(
      db,
      assignmentId,
      materialId,
      ctx.access.canEditAssignments,
    );
    if ("error" in resolved) {
      const status = resolved.error === "forbidden" ? 403 : 404;
      return c.json({ error: resolved.error }, status);
    }

    const questions = await db
      .select()
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.materialId, materialId))
      .orderBy(asc(schoolTestQuestions.sortOrder), asc(schoolTestQuestions.createdAt));

    return c.json({ questions: questions.map(serializeQuestionPreview) });
  });

  app.post("/assignments/:id/materials/:materialId/questions", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);

    const resolved = await staffNativeTestMaterial(
      db,
      assignmentId,
      materialId,
      ctx.access.canEditAssignments,
    );
    if ("error" in resolved) {
      const status = resolved.error === "forbidden" ? 403 : 404;
      return c.json({ error: resolved.error }, status);
    }
    if (resolved.material.frozenAt) return c.json({ error: "material_frozen" }, 409);

    const body = await c.req.json<{
      questionType?: SchoolQuestionType;
      promptMarkdown?: string;
      sortOrder?: number;
      points?: number | null;
      weight?: number | null;
      optionsJson?: Array<{ id: string; label: string }> | null;
      correctAnswerJson?: Record<string, unknown> | null;
    }>();

    const pointsMode = resolved.material.nativeTestPointsMode ?? "explicit";
    const validated = validateQuestionInput(body, { pointsMode, isCreate: true });
    if (!validated.ok) return c.json({ error: validated.error }, 400);

    const existing = await db
      .select({ sortOrder: schoolTestQuestions.sortOrder })
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.materialId, materialId));
    const nextSort =
      body.sortOrder ??
      existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;

    const [row] = await db
      .insert(schoolTestQuestions)
      .values({
        materialId,
        sortOrder: nextSort,
        questionType: validated.value.questionType,
        promptMarkdown: validated.value.promptMarkdown,
        points: validated.value.points ?? null,
        weight: validated.value.weight ?? null,
        optionsJson: validated.value.optionsJson,
        correctAnswerJson: validated.value.correctAnswerJson,
      })
      .returning();

    return c.json({ question: serializeQuestionStaff(row!) }, 201);
  });

  app.patch("/assignments/:id/materials/:materialId/questions/:questionId", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const questionId = c.req.param("questionId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);

    const resolved = await staffNativeTestMaterial(
      db,
      assignmentId,
      materialId,
      ctx.access.canEditAssignments,
    );
    if ("error" in resolved) {
      const status = resolved.error === "forbidden" ? 403 : 404;
      return c.json({ error: resolved.error }, status);
    }
    if (resolved.material.frozenAt) return c.json({ error: "material_frozen" }, 409);

    const [existing] = await db
      .select()
      .from(schoolTestQuestions)
      .where(
        and(
          eq(schoolTestQuestions.id, questionId),
          eq(schoolTestQuestions.materialId, materialId),
        ),
      )
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json<{
      questionType?: SchoolQuestionType;
      promptMarkdown?: string;
      sortOrder?: number;
      points?: number | null;
      weight?: number | null;
      optionsJson?: Array<{ id: string; label: string }> | null;
      correctAnswerJson?: Record<string, unknown> | null;
    }>();

    const pointsMode = resolved.material.nativeTestPointsMode ?? "explicit";
    const validated = validateQuestionInput(
      {
        questionType: (body.questionType ?? existing.questionType) as SchoolQuestionType,
        promptMarkdown: body.promptMarkdown ?? existing.promptMarkdown,
        sortOrder: body.sortOrder,
        points: body.points !== undefined ? body.points : existing.points,
        weight: body.weight !== undefined ? body.weight : existing.weight,
        optionsJson: body.optionsJson !== undefined ? body.optionsJson : existing.optionsJson,
        correctAnswerJson:
          body.correctAnswerJson !== undefined
            ? body.correctAnswerJson
            : (existing.correctAnswerJson as Record<string, unknown> | null),
      },
      { pointsMode },
    );
    if (!validated.ok) return c.json({ error: validated.error }, 400);

    const [row] = await db
      .update(schoolTestQuestions)
      .set({
        sortOrder: body.sortOrder ?? existing.sortOrder,
        questionType: validated.value.questionType,
        promptMarkdown: validated.value.promptMarkdown,
        points: validated.value.points ?? null,
        weight: validated.value.weight ?? null,
        optionsJson: validated.value.optionsJson,
        correctAnswerJson: validated.value.correctAnswerJson,
        updatedAt: new Date(),
      })
      .where(eq(schoolTestQuestions.id, questionId))
      .returning();

    return c.json({ question: serializeQuestionStaff(row!) });
  });

  app.delete("/assignments/:id/materials/:materialId/questions/:questionId", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const questionId = c.req.param("questionId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);

    const resolved = await staffNativeTestMaterial(
      db,
      assignmentId,
      materialId,
      ctx.access.canEditAssignments,
    );
    if ("error" in resolved) {
      const status = resolved.error === "forbidden" ? 403 : 404;
      return c.json({ error: resolved.error }, status);
    }
    if (resolved.material.frozenAt) return c.json({ error: "material_frozen" }, 409);

    const [existing] = await db
      .select({ id: schoolTestQuestions.id })
      .from(schoolTestQuestions)
      .where(
        and(
          eq(schoolTestQuestions.id, questionId),
          eq(schoolTestQuestions.materialId, materialId),
        ),
      )
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    await db.delete(schoolTestQuestions).where(eq(schoolTestQuestions.id, questionId));
    return c.json({ ok: true });
  });

  app.get("/assignments/:id/materials/:materialId/test", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canSubmit && ctx.access.viewMode !== "observer") {
      return c.json({ error: "forbidden" }, 403);
    }

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
    if (!material || material.source !== "native_test") {
      return c.json({ error: "not_found" }, 404);
    }
    if (!materialVisibleToViewer(material, ctx.access.viewMode)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const questions = await db
      .select()
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.materialId, materialId))
      .orderBy(asc(schoolTestQuestions.sortOrder), asc(schoolTestQuestions.createdAt));

    let submissionId: string | null = null;
    let turnInNumber = 1;
    let turnInCount = 0;
    let draftLocked = false;

    if (ctx.access.canSubmit) {
      let [submission] = await db
        .select()
        .from(schoolSubmissions)
        .where(
          and(
            eq(schoolSubmissions.assignmentId, assignmentId),
            eq(schoolSubmissions.studentMemberId, ctx.context.memberId),
          ),
        )
        .limit(1);
      if (!submission) {
        const [created] = await db
          .insert(schoolSubmissions)
          .values({
            assignmentId,
            studentMemberId: ctx.context.memberId,
            status: "not_started",
          })
          .returning();
        submission = created!;
      }
      submissionId = submission.id;
      turnInCount = submission.turnInCount;
      turnInNumber = submission.turnInCount + 1;
      if (isAttemptsExhausted(ctx.assignment.maxAttempts, submission.turnInCount)) {
        draftLocked = true;
        turnInNumber = Math.max(1, submission.turnInCount);
      }
    }

    return c.json({
      material: serializeMaterial(material, { viewMode: ctx.access.viewMode }),
      questions: questions.map(serializeQuestionPreview),
      frozen: Boolean(material.frozenAt),
      submissionId,
      turnInNumber,
      turnInCount,
      draftLocked,
      canSubmit: ctx.access.canSubmit && !draftLocked,
      access: ctx.access,
    });
  });

  app.get("/assignments/:id/materials/:materialId/test-responses", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canSubmit) return c.json({ error: "forbidden" }, 403);

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
    if (!material || material.source !== "native_test") {
      return c.json({ error: "not_found" }, 404);
    }

    const [submission] = await db
      .select()
      .from(schoolSubmissions)
      .where(
        and(
          eq(schoolSubmissions.assignmentId, assignmentId),
          eq(schoolSubmissions.studentMemberId, ctx.context.memberId),
        ),
      )
      .limit(1);
    if (!submission) return c.json({ responses: [], turnInNumber: 1 });

    const turnInNumber = isAttemptsExhausted(ctx.assignment.maxAttempts, submission.turnInCount)
      ? Math.max(1, submission.turnInCount)
      : submission.turnInCount + 1;

    const rows = await db
      .select()
      .from(schoolSubmissionResponses)
      .where(
        and(
          eq(schoolSubmissionResponses.submissionId, submission.id),
          eq(schoolSubmissionResponses.materialId, materialId),
          eq(schoolSubmissionResponses.turnInNumber, turnInNumber),
        ),
      );

    return c.json({
      submissionId: submission.id,
      turnInNumber,
      responses: rows.map((row) => ({
        questionId: row.questionId,
        responseJson: row.responseJson,
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  });

  app.patch("/assignments/:id/materials/:materialId/test-responses", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.access.canSubmit) return c.json({ error: "forbidden" }, 403);

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
    if (!material || material.source !== "native_test") {
      return c.json({ error: "not_found" }, 404);
    }
    if (!materialVisibleToViewer(material, ctx.access.viewMode)) {
      return c.json({ error: "forbidden" }, 403);
    }

    let [submission] = await db
      .select()
      .from(schoolSubmissions)
      .where(
        and(
          eq(schoolSubmissions.assignmentId, assignmentId),
          eq(schoolSubmissions.studentMemberId, ctx.context.memberId),
        ),
      )
      .limit(1);
    if (!submission) {
      const [created] = await db
        .insert(schoolSubmissions)
        .values({
          assignmentId,
          studentMemberId: ctx.context.memberId,
          status: "not_started",
        })
        .returning();
      submission = created!;
    }

    if (isAttemptsExhausted(ctx.assignment.maxAttempts, submission.turnInCount)) {
      return c.json({ error: "attempts_exhausted" }, 403);
    }

    const turnInNumber = submission.turnInCount + 1;
    const body = await c.req.json<{
      responses?: Array<{ questionId: string; responseJson: Record<string, unknown> }>;
    }>();
    const incoming = body.responses ?? [];
    if (incoming.length === 0) return c.json({ error: "responses_required" }, 400);

    const questionRows = await db
      .select({ id: schoolTestQuestions.id })
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.materialId, materialId));
    const allowed = new Set(questionRows.map((q) => q.id));

    const now = new Date();
    for (const item of incoming) {
      if (!allowed.has(item.questionId)) continue;
      const responseJson =
        item.responseJson && typeof item.responseJson === "object" ? item.responseJson : {};
      const [existing] = await db
        .select({ id: schoolSubmissionResponses.id })
        .from(schoolSubmissionResponses)
        .where(
          and(
            eq(schoolSubmissionResponses.submissionId, submission.id),
            eq(schoolSubmissionResponses.questionId, item.questionId),
            eq(schoolSubmissionResponses.turnInNumber, turnInNumber),
          ),
        )
        .limit(1);
      if (existing) {
        await db
          .update(schoolSubmissionResponses)
          .set({ responseJson, updatedAt: now })
          .where(eq(schoolSubmissionResponses.id, existing.id));
      } else {
        await db.insert(schoolSubmissionResponses).values({
          submissionId: submission.id,
          materialId,
          questionId: item.questionId,
          turnInNumber,
          responseJson,
        });
      }
    }

    await db
      .update(schoolSubmissions)
      .set({ updatedAt: now })
      .where(eq(schoolSubmissions.id, submission.id));

    const rows = await db
      .select()
      .from(schoolSubmissionResponses)
      .where(
        and(
          eq(schoolSubmissionResponses.submissionId, submission.id),
          eq(schoolSubmissionResponses.materialId, materialId),
          eq(schoolSubmissionResponses.turnInNumber, turnInNumber),
        ),
      );

    return c.json({
      submissionId: submission.id,
      turnInNumber,
      responses: rows.map((row) => ({
        questionId: row.questionId,
        responseJson: row.responseJson,
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  });

  app.get("/assignments/:id/materials/:materialId/snapshot", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const materialId = c.req.param("materialId");
    const ctx = await assignmentAccessForAuth(db, auth, assignmentId);
    if (!ctx) return c.json({ error: "not_found" }, 404);

    const [row] = await db
      .select()
      .from(schoolAssignmentMaterials)
      .where(
        and(
          eq(schoolAssignmentMaterials.id, materialId),
          eq(schoolAssignmentMaterials.assignmentId, assignmentId),
        ),
      )
      .limit(1);
    if (!row || !materialVisibleToViewer(row, ctx.access.viewMode)) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!row.frozenAt || !row.snapshotS3Key) return c.json({ error: "snapshot_not_available" }, 404);

    const buf = await getObjectBuffer(env, row.snapshotS3Key);
    if (!buf) return c.json({ error: "not_found" }, 404);

    const filename = row.displayName.replace(/"/g, "") || "snapshot";
    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": contentTypeFromKey(row.snapshotS3Key),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    });
  });

  return app;
}
