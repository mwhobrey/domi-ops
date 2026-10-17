import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import type { AuthContext } from "@domi-ops/auth";
import { closeDb, createDb, createScopedDb, households, users, householdMembers, schoolClasses, schoolAssignments, schoolAssignmentMaterials, schoolAssignmentCategories, schoolTestQuestions, schoolSubmissions, schoolEnrollments, withHouseholdContext, withSystemContext, type Database } from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { createTenantMiddleware } from "../middleware/tenant.js";
import { schoolCourseToolsRoutes } from "./school-course-tools.js";
const url = process.env.HOSTED_TEST_DATABASE_URL;
(url ? describe : describe.skip)("School course reuse and bulk dates", () => {
  let db: Database, app: Hono<{ Variables: AppVariables }>, classId: string, categoryId: string;
  const hh: string[] = [], userIds: string[] = [], assignmentIds: string[] = [];
  const people: Record<string, AuthContext> = {};
  const env = { AUTH_REQUIRED: true, DEPLOYMENT_MODE: "single", MODULES_ENABLED: ["core", "school"] } as Env;
  const call = (path: string, body: unknown, person = "owner") => app.request(`/api/school${path}`, { method: "POST", headers: { "x-as": person, "content-type": "application/json" }, body: JSON.stringify(body) });
  beforeAll(async () => {
    db = createDb(url!);
    await withSystemContext(db, async (tx) => {
      for (const name of ["alpha", "beta"]) { const [h] = await tx.insert(households).values({ name: `course-${randomUUID()}`, timezone: "America/Chicago" }).returning(); hh.push(h.id); }
      for (const name of ["owner", "student", "foreign"]) {
        const [u] = await tx.insert(users).values({ username: `course-${randomUUID()}` }).returning(); userIds.push(u.id);
        const [m] = await tx.insert(householdMembers).values({ householdId: name === "foreign" ? hh[1] : hh[0], userId: u.id, role: name === "student" ? "child" : "owner" }).returning();
        people[name] = { householdId: m.householdId, memberId: m.id, userId: u.id, role: m.role } as AuthContext;
      }
    });
    await withHouseholdContext(db, hh[0], async (tx) => {
      const [cl] = await tx.insert(schoolClasses).values({ householdId: hh[0], name: "Synthetic course", teacherMemberId: people.owner.memberId }).returning(); classId = cl.id;
      await tx.insert(schoolEnrollments).values({ classId, memberId: people.student.memberId, role: "student" });
      const [category] = await tx.insert(schoolAssignmentCategories).values({ classId, name: "Tests", weightPercent: 100 }).returning(); categoryId = category.id;
      for (let i = 0; i < 2; i++) {
        const [a] = await tx.insert(schoolAssignments).values({ classId, categoryId, title: `Lesson ${i}`, dueAt: new Date("2026-03-07T18:00:00Z"), visibility: "assigned", createdByUserId: people.owner.userId }).returning(); assignmentIds.push(a.id);
      }
      const [m] = await tx.insert(schoolAssignmentMaterials).values({ assignmentId: assignmentIds[0], source: "native_test", displayName: "Synthetic test", isTest: true, nativeTestPointsMode: "explicit", frozenAt: new Date(), snapshotS3Key: `school/${hh[0]}/old-snapshot`, createdByUserId: people.owner.userId }).returning();
      await tx.insert(schoolTestQuestions).values({ materialId: m.id, questionType: "short_answer", promptMarkdown: "Synthetic prompt", correctAnswerJson: { accepted: ["answer"] }, points: 1 });
    });
    const scoped = createScopedDb(db); app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => { c.set("auth", people[c.req.header("x-as") ?? "owner"]); await next(); });
    app.use("*", createTenantMiddleware(scoped, env)); app.route("/api/school", schoolCourseToolsRoutes(scoped, env));
  });
  afterAll(async () => {
    if (!db) return;
    await withSystemContext(db, async (tx) => { await tx.delete(households).where(inArray(households.id, hh)); await tx.delete(users).where(inArray(users.id, userIds)); }); await closeDb(db);
  });
  it("denies student and foreign household course tools", async () => {
    for (const person of ["student", "foreign"]) {
      expect((await call(`/classes/${classId}/reuse`, { name: "Denied" }, person)).status).toBe(404);
      expect((await call(`/classes/${classId}/reschedule`, { assignmentIds, days: 2 }, person)).status).toBe(404);
    }
  });
  it("previews household calendar days across DST, rejects stale previews, and applies atomically", async () => {
    const result = await call(`/classes/${classId}/reschedule`, { assignmentIds, days: 2 }); expect(result.status).toBe(200);
    const preview = await result.json() as { changes: { id: string; before: string; after: string }[] };
    expect(preview.changes.every((c) => c.after === "2026-03-09T17:00:00.000Z")).toBe(true);
    const expected = preview.changes.map(({ id, before, after }) => ({ id, before, after }));
    const stale = expected.map((row, i) => i === 0 ? { ...row, before: "2000-01-01T00:00:00.000Z" } : row);
    expect((await call(`/classes/${classId}/reschedule`, { assignmentIds, days: 2, apply: true, expected: stale })).status).toBe(409);
    await withHouseholdContext(db, hh[0], async (tx) => expect((await tx.select().from(schoolAssignments).where(inArray(schoolAssignments.id, assignmentIds))).every((r) => r.dueAt?.toISOString() === "2026-03-07T18:00:00.000Z")).toBe(true));
    expect((await call(`/classes/${classId}/reschedule`, { assignmentIds, days: 2, apply: true, expected })).status).toBe(200);
    await withHouseholdContext(db, hh[0], async (tx) => { await tx.insert(schoolSubmissions).values({ assignmentId: assignmentIds[0], studentMemberId: people.student.memberId, status: "submitted" }); });
    expect((await call(`/classes/${classId}/reschedule`, { assignmentIds, days: 2 })).status).toBe(409);
  });
  it("copies course teaching content into undated drafts with new categories and test questions", async () => {
    const response = await call(`/classes/${classId}/reuse`, { name: "Next term", term: "2027" }); expect(response.status).toBe(201);
    const data = await response.json() as { class: { id: string }; assignmentsCopied: number }; expect(data.assignmentsCopied).toBe(2);
    await withHouseholdContext(db, hh[0], async (tx) => {
      const assignments = await tx.select().from(schoolAssignments).where(eq(schoolAssignments.classId, data.class.id));
      expect(assignments.every((a) => a.visibility === "draft" && a.dueAt === null && a.categoryId !== categoryId)).toBe(true);
      const mats = await tx.select().from(schoolAssignmentMaterials).where(inArray(schoolAssignmentMaterials.assignmentId, assignments.map((a) => a.id)));
      expect(mats).toHaveLength(1); expect(mats[0]).toMatchObject({ frozenAt: null, snapshotS3Key: null, createdByUserId: people.owner.userId });
      expect(await tx.select().from(schoolTestQuestions).where(eq(schoolTestQuestions.materialId, mats[0].id))).toHaveLength(1);
      expect(await tx.select().from(schoolSubmissions).where(inArray(schoolSubmissions.assignmentId, assignments.map((a) => a.id)))).toHaveLength(0);
      expect(await tx.select().from(schoolEnrollments).where(eq(schoolEnrollments.classId, data.class.id))).toHaveLength(0);
    });
  });
});
