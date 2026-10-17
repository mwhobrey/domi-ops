import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { households, schoolAssignmentCategories, schoolAssignments, schoolClasses, schoolEnrollments, schoolSubmissions, type Database } from "@domi-ops/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { requireAuth, type AppVariables } from "../middleware/auth.js";
import { resolveClassAccess } from "../lib/school-access.js";
import { memberForUser } from "../lib/school-route-context.js";
import { copyTeachingAssignment } from "../lib/school-reuse.js";
import { requireHouseholdModule } from "../lib/household-modules.js";

export function schoolCourseToolsRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));
  app.use("*", requireHouseholdModule(db, env, "school"));
  async function editableClass(auth: NonNullable<AppVariables["auth"]>, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [cls] = await db.select().from(schoolClasses).where(and(eq(schoolClasses.id, id), eq(schoolClasses.householdId, auth.householdId))).limit(1);
    const member = await memberForUser(db, auth.householdId, auth.userId);
    if (!cls || !member) return null;
    const [enrollment] = await db.select().from(schoolEnrollments).where(and(eq(schoolEnrollments.classId, id), eq(schoolEnrollments.memberId, member.id))).limit(1);
    return resolveClassAccess({ memberId: member.id, householdRole: member.role, teacherMemberId: cls.teacherMemberId, enrollment: enrollment ?? null }).canEditAssignments ? cls : null;
  }
  app.post("/classes/:id/reuse", async (c) => {
    const auth = c.get("auth")!, cls = await editableClass(auth, c.req.param("id"));
    if (!cls) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ name?: string; term?: string }>().catch(() => null);
    if (typeof body?.name !== "string" || !body.name.trim() || body.name.trim().length > 128 || (body.term != null && (typeof body.term !== "string" || body.term.length > 64))) return c.json({ error: "invalid_body" }, 400);
    return db.transaction(async (tx) => {
      const assignments = await tx.select().from(schoolAssignments).where(eq(schoolAssignments.classId, cls.id)).orderBy(asc(schoolAssignments.id)).for("update");
      if (assignments.length > 200) return c.json({ error: "course_too_large", message: "Reuse supports up to 200 assignments. Copy smaller courses or individual assignments." }, 400);
      const [copy] = await tx.insert(schoolClasses).values({ householdId: auth.householdId, name: body.name!.trim(), subject: cls.subject, term: body.term?.trim() || null, teacherMemberId: auth.memberId, credits: cls.credits }).returning();
      const categories = await tx.select().from(schoolAssignmentCategories).where(eq(schoolAssignmentCategories.classId, cls.id));
      const map = new Map<string, string>();
      for (const category of categories) {
        const [created] = await tx.insert(schoolAssignmentCategories).values({ classId: copy.id, name: category.name, weightPercent: category.weightPercent, gradingPolicy: category.gradingPolicy }).returning(); map.set(category.id, created.id);
      }
      for (const assignment of assignments) await copyTeachingAssignment(tx as unknown as Database, assignment, copy.id, assignment.categoryId ? map.get(assignment.categoryId) ?? null : null, auth.userId);
      return c.json({ class: copy, assignmentsCopied: assignments.length }, 201);
    });
  });
  app.post("/classes/:id/reschedule", async (c) => {
    const auth = c.get("auth")!, cls = await editableClass(auth, c.req.param("id"));
    if (!cls) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ assignmentIds?: unknown; days?: unknown; apply?: unknown; expected?: unknown }>().catch(() => null);
    if (!Array.isArray(body?.assignmentIds) || !body.assignmentIds.length || body.assignmentIds.length > 200 || body.assignmentIds.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) || !Number.isInteger(body.days) || body.days === 0 || Math.abs(body.days as number) > 366 || (body.apply != null && typeof body.apply !== "boolean")) return c.json({ error: "invalid_body" }, 400);
    const ids = [...new Set(body.assignmentIds as string[])].sort(), days = body.days as number;
    return db.transaction(async (tx) => {
      const rows = await tx.select().from(schoolAssignments).where(and(eq(schoolAssignments.classId, cls.id), inArray(schoolAssignments.id, ids))).orderBy(asc(schoolAssignments.id)).for("update");
      if (rows.length !== ids.length) return c.json({ error: "assignment_not_found" }, 404);
      const work = await tx.select({ id: schoolSubmissions.assignmentId }).from(schoolSubmissions).where(and(inArray(schoolSubmissions.assignmentId, ids), ne(schoolSubmissions.status, "not_started"))).limit(1);
      if (work.length || rows.some((r) => !r.dueAt || r.visibility === "closed")) return c.json({ error: "ineligible_assignments", message: "Choose dated draft or assigned work with no submitted, graded, returned or excused submissions." }, 409);
      const [hh] = await tx.select({ timezone: households.timezone }).from(households).where(eq(households.id, auth.householdId));
      const changes: { id: string; title: string; before: string; after: string }[] = [];
      for (const row of rows) {
        const [date] = await tx.execute<{ due: Date }>(sql`select ((${row.dueAt!.toISOString()}::timestamptz at time zone ${hh.timezone}) + make_interval(days => ${days})) at time zone ${hh.timezone} as due`);
        changes.push({ id: row.id, title: row.title, before: row.dueAt!.toISOString(), after: new Date(date.due).toISOString() });
      }
      if (body.apply) {
        if (!Array.isArray(body.expected) || JSON.stringify(body.expected) !== JSON.stringify(changes.map(({ id, before, after }) => ({ id, before, after })))) return c.json({ error: "schedule_changed", message: "The schedule changed. Preview again before applying." }, 409);
        for (const change of changes) await tx.update(schoolAssignments).set({ dueAt: new Date(change.after) }).where(eq(schoolAssignments.id, change.id));
      }
      return c.json({ applied: body.apply === true, timezone: hh.timezone, changes });
    });
  });
  return app;
}
