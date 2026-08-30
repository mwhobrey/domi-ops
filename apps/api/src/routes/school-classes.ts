import { Hono } from "hono";
import { memberShownLabel } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import { isHouseholdModuleEnabled } from "../lib/household-modules.js";
import type { Database } from "@domi-ops/db";
import {
  householdMembers,
  schoolAssignmentCategories,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  users,
} from "@domi-ops/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { resolveClassAccess, visibleClassIdsForMember } from "../lib/school-access.js";
import { publishedAssignmentVisibilities } from "../lib/school-assignment-visibility.js";
import { buildClassGradebook } from "../lib/school-gradebook.js";
import { buildSchoolReports, canViewSchoolReports } from "../lib/school-reports.js";
import {
  classForHousehold,
  enrollmentForHousehold,
  memberEnrollmentsForHousehold,
  memberForUser,
  schoolContextForAuth,
} from "../lib/school-route-context.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

// Class roster management (classes/enrollments/grading categories) plus the cross-class
// overview reads (members/context/glance/assignments-list/gradebook/reports) that share the
// same visibility-resolution helpers — split out of the school.ts monolith (2026-08-30).
// See school-assignments.ts and school-materials.ts for the rest of the /api/school surface.
export function schoolClassesRoutes(db: Database, env: Env) {
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


  return app;
}
