import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  schoolAssignmentMaterials,
  schoolSubmissionResponses,
  schoolSubmissions,
  schoolTestQuestions,
} from "@domi-ops/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { fetchGoogleDriveFileMetadata, GOOGLE_FORMS_MIME } from "../lib/google-drive-export.js";
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
  isAttemptsExhausted,
  materialVisibleToViewer,
  serializeMaterial,
  validateMaterialInput,
  type SchoolMaterialSource,
} from "../lib/school-materials.js";
import {
  serializeQuestionPreview,
  serializeQuestionStaff,
  validateQuestionInput,
  type SchoolNativeTestPointsMode,
  type SchoolQuestionType,
} from "../lib/school-test-questions.js";
import { contentTypeFromKey, getObjectBuffer } from "../lib/s3.js";
import {
  assignmentAccessForAuth,
  loadAssignmentMaterials,
  loadConvertibleSourceMaterial,
  resolveDriveSource,
  staffNativeTestMaterial,
} from "../lib/school-route-context.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

// Assignment materials: CRUD, Google Doc export/import conversion, native-test authoring
// (question bank), student test-taking + auto-grading, and the frozen-snapshot download used
// once a test material is locked — split out of the school.ts monolith (2026-08-30). See
// school-classes.ts and school-assignments.ts for the rest of the /api/school surface.
export function schoolMaterialsRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

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
