import { Hono } from "hono";
import { memberShownLabel } from "@whome/auth";
import type { Env } from "@whome/config";
import { isModuleEnabled } from "@whome/config";
import type { Database } from "@whome/db";
import {
  householdMembers,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolGrades,
  schoolSubmissionArtifacts,
  schoolSubmissions,
  users,
} from "@whome/db";
import { and, eq } from "drizzle-orm";
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

export function schoolRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/members", async (c) => {
    if (!isModuleEnabled(env, "school")) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const auth = c.get("auth")!;
    const rows = await db
      .select({
        id: householdMembers.id,
        role: householdMembers.role,
        name: householdMembers.name,
        nickname: householdMembers.nickname,
        publicLabel: householdMembers.publicLabel,
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

  app.get("/classes", async (c) => {
    if (!isModuleEnabled(env, "school")) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const auth = c.get("auth")!;
    const classes = await db
      .select()
      .from(schoolClasses)
      .where(eq(schoolClasses.householdId, auth.householdId));
    return c.json({ classes });
  });

  app.post("/classes", async (c) => {
    const auth = c.get("auth")!;
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
    const [row] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    const enrollments = await db
      .select()
      .from(schoolEnrollments)
      .where(eq(schoolEnrollments.classId, classId));
    return c.json({ class: row, enrollments });
  });

  app.patch("/classes/:classId", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    const body = await c.req.json<{ name?: string; subject?: string; term?: string; archived?: boolean }>();
    const [row] = await db
      .update(schoolClasses)
      .set({ ...body, updatedAt: new Date() })
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
    const classId = c.req.param("classId");
    const rows = await db
      .select()
      .from(schoolEnrollments)
      .where(eq(schoolEnrollments.classId, classId));
    return c.json({ enrollments: rows });
  });

  app.post("/classes/:classId/enrollments", async (c) => {
    const classId = c.req.param("classId");
    const body = await c.req.json<{ memberId: string; role?: string }>();
    const [row] = await db
      .insert(schoolEnrollments)
      .values({
        classId,
        memberId: body.memberId,
        role: body.role ?? "student",
      })
      .returning();
    return c.json({ enrollment: row }, 201);
  });

  app.delete("/enrollments/:enrollmentId", async (c) => {
    const enrollmentId = c.req.param("enrollmentId");
    await db.delete(schoolEnrollments).where(eq(schoolEnrollments.id, enrollmentId));
    return c.json({ ok: true });
  });

  app.get("/classes/:classId/assignments", async (c) => {
    const classId = c.req.param("classId");
    const rows = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.classId, classId));
    return c.json({ assignments: rows });
  });

  app.post("/classes/:classId/assignments", async (c) => {
    const auth = c.get("auth")!;
    const classId = c.req.param("classId");
    const body = await c.req.json<{
      title: string;
      instructionsHtml?: string;
      dueAt?: string;
      pointsPossible?: number;
      visibility?: "draft" | "assigned" | "closed";
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
    return c.json({ assignment: row, class: cls });
  });

  app.patch("/assignments/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      instructionsHtml?: string;
      dueAt?: string | null;
      pointsPossible?: number;
      visibility?: "draft" | "assigned" | "closed";
    }>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.instructionsHtml !== undefined) patch.instructionsHtml = body.instructionsHtml;
    if (body.dueAt !== undefined) patch.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    if (body.pointsPossible !== undefined) patch.pointsPossible = body.pointsPossible;
    if (body.visibility !== undefined) patch.visibility = body.visibility;
    const [row] = await db
      .update(schoolAssignments)
      .set(patch)
      .where(eq(schoolAssignments.id, id))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ assignment: row });
  });

  app.delete("/assignments/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(schoolAssignments).where(eq(schoolAssignments.id, id));
    return c.json({ ok: true });
  });

  app.get("/assignments/:id/submissions", async (c) => {
    const id = c.req.param("id");
    const subs = await db
      .select()
      .from(schoolSubmissions)
      .where(eq(schoolSubmissions.assignmentId, id));
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
        return { ...s, grade: grade ?? null, artifacts };
      }),
    );
    return c.json({ submissions: withGrades });
  });

  app.post("/assignments/:id/submit", async (c) => {
    const auth = c.get("auth")!;
    const assignmentId = c.req.param("id");
    const body = await c.req.json<{ studentMemberId?: string; studentNote?: string }>();
    const hm = await memberForUser(db, auth.householdId, auth.userId);
    if (!hm) return c.json({ error: "not_a_member" }, 403);
    const studentMemberId = body.studentMemberId ?? hm.id;

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

    const now = new Date();
    if (existing) {
      const [updated] = await db
        .update(schoolSubmissions)
        .set({
          status: "submitted",
          submittedAt: now,
          studentNote: body.studentNote ?? existing.studentNote,
          updatedAt: now,
        })
        .where(eq(schoolSubmissions.id, existing.id))
        .returning();
      return c.json({ submission: updated });
    }

    const [created] = await db
      .insert(schoolSubmissions)
      .values({
        assignmentId,
        studentMemberId,
        status: "submitted",
        submittedAt: now,
        studentNote: body.studentNote ?? "",
      })
      .returning();
    return c.json({ submission: created }, 201);
  });

  app.post("/submissions/:id/artifacts", async (c) => {
    const submissionId = c.req.param("id");
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
    return c.json({ artifact: art }, 201);
  });

  app.delete("/artifacts/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(schoolSubmissionArtifacts).where(eq(schoolSubmissionArtifacts.id, id));
    return c.json({ ok: true });
  });

  app.post("/submissions/:id/grade", async (c) => {
    const auth = c.get("auth")!;
    const submissionId = c.req.param("id");
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

  return app;
}
