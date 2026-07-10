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
  schoolSubmissions,
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
  fetchGoogleDriveFileMetadata,
  GOOGLE_FORMS_MIME,
} from "../lib/google-drive-export.js";
import {
  ensureGoogleDocsAccessToken,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "../lib/google-docs-export.js";
import {
  attemptsRemaining,
  isAttemptsExhausted,
  materialVisibleToViewer,
  serializeMaterial,
  validateMaterialInput,
  type SchoolMaterialSource,
} from "../lib/school-materials.js";
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
      if (sourceMaterials.length > 0) {
        await db.insert(schoolAssignmentMaterials).values(
          sourceMaterials.map((m) => ({
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
            studentVisible: m.studentVisible,
            observerVisible: m.observerVisible,
            createdByUserId: auth.userId,
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

    return c.json({
      submission: submissionRow,
      attemptsRemaining: attemptsRemaining(assignmentRow.maxAttempts, submissionRow.turnInCount),
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
    if (artifact.url && !artifact.s3Key) {
      return c.redirect(artifact.url);
    }
    if (!artifact.s3Key) return c.json({ error: "not_found" }, 404);

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
    const id = c.req.param("id");
    await db.delete(schoolSubmissionArtifacts).where(eq(schoolSubmissionArtifacts.id, id));
    return c.json({ ok: true });
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

    if (source === "google_doc" || googleFileId) {
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
        isTest: validated.value.isTest ?? false,
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
