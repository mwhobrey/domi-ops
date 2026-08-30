import { Hono } from "hono";
import { memberShownLabel } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  householdMembers,
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
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { resolveClassAccess, visibleClassIdsForMember } from "../lib/school-access.js";
import { canSubmitPastDue, isSubmissionLate } from "../lib/school-submission.js";
import { freezeAssignmentTestMaterials } from "../lib/school-material-freeze.js";
import { SchoolMaterialFreezeError } from "../lib/school-material-freeze-errors.js";
import { fetchGoogleDriveFileMetadata, googleFileWebUrl } from "../lib/google-drive-export.js";
import {
  ensureGoogleDocsAccessToken,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "../lib/google-docs-export.js";
import {
  attemptsRemaining,
  isAttemptsExhausted,
  materialVisibleToViewer,
} from "../lib/school-materials.js";
import { verifyGoogleSubmissionLineage } from "../lib/school-google-lineage.js";
import {
  assignmentNeedsGoogleConnection,
  ensureGoogleStudentCopy,
  runGoogleLineageChecks,
  serializeSubmissionArtifact,
} from "../lib/school-google-workflow.js";
import {
  serializeQuestionStaff,
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
import {
  assignmentAccessForAuth,
  loadAssignmentMaterials,
  memberEnrollmentsForHousehold,
  schoolContextForAuth,
} from "../lib/school-route-context.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

// Assignment CRUD + the submission/grading workflow (submit, artifacts, Google Classroom-style
// student-copy flow, grading, test review) — split out of the school.ts monolith (2026-08-30).
// See school-classes.ts and school-materials.ts for the rest of the /api/school surface.
export function schoolAssignmentsRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

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


  return app;
}
