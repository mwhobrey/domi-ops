import { Hono } from "hono";
import type { Env } from "@whome/config";
import { isModuleEnabled } from "@whome/config";
import type { Database } from "@whome/db";
import {
  householdMembers,
  schoolAssignments,
  schoolClasses,
  schoolGrades,
  schoolSubmissions,
} from "@whome/db";
import { and, eq } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function schoolRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

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
    const body = await c.req.json<{ name: string; subject?: string }>();
    const [hm] = await db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, auth.userId),
          eq(householdMembers.householdId, auth.householdId),
        ),
      )
      .limit(1);
    if (!hm) return c.json({ error: "not_a_member" }, 403);
    const [row] = await db
      .insert(schoolClasses)
      .values({
        householdId: auth.householdId,
        name: body.name,
        subject: body.subject,
        teacherMemberId: hm.id,
      })
      .returning();
    return c.json({ class: row }, 201);
  });

  app.get("/classes/:classId/assignments", async (c) => {
    const classId = c.req.param("classId");
    const rows = await db
      .select()
      .from(schoolAssignments)
      .where(eq(schoolAssignments.classId, classId));
    return c.json({ assignments: rows });
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
        return { ...s, grade: grade ?? null };
      }),
    );
    return c.json({ submissions: withGrades });
  });

  return app;
}
