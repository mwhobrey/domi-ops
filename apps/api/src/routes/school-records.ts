import { Hono } from "hono";
import type { Context } from "hono";
import { memberShownLabel } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  householdMembers,
  households,
  schoolAssignmentCategories,
  schoolAttendance,
  schoolClasses,
  schoolEnrollments,
  schoolHoursLog,
  users,
} from "@domi-ops/db";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { isHouseholdModuleEnabled } from "../lib/household-modules.js";
import { isHouseholdAdmin, resolveClassAccess } from "../lib/school-access.js";
import { buildClassGradebook } from "../lib/school-gradebook.js";
import {
  isAttendanceStatus,
  isIsoDate,
  minutesToHours,
  parseMinutes,
  summarizeSchoolDays,
  tallyAttendance,
  totalMinutes,
  type AttendanceStatus,
} from "../lib/school-records.js";
import { computePointsAverage, computeWeightedGrade } from "../lib/school-report-math.js";
import { memberEnrollmentsForHousehold, schoolContextForAuth } from "../lib/school-route-context.js";
import { buildTranscript } from "../lib/school-transcript-math.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

type Ctx = Context<{ Variables: AppVariables }>;
type SchoolContext = NonNullable<Awaited<ReturnType<typeof schoolContextForAuth>>>;

const MAX_ATTENDANCE_ENTRIES = 200;
const MAX_TEXT = 500;

function rangeFromQuery(c: Ctx): { from?: string; to?: string } | { error: string } {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from && !isIsoDate(from)) return { error: "invalid_from" };
  if (to && !isIsoDate(to)) return { error: "invalid_to" };
  return { from: from || undefined, to: to || undefined };
}

// Attendance, instruction hours, and transcripts. Split from school-classes.ts, which owns the
// class/roster/gradebook routes these build on. Records are the parent's paper trail, so writes
// are staff-only and a student only ever reads their own.
export function schoolRecordsRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  /** Loads the caller's school context, or a ready-made error response. */
  async function loadContext(c: Ctx): Promise<SchoolContext | Response> {
    const auth = c.get("auth")!;
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "school"))) {
      return c.json({ error: "school_disabled" }, 403);
    }
    const context = await schoolContextForAuth(db, auth);
    if (!context) return c.json({ error: "not_a_member" }, 403);
    return context;
  }

  async function memberLabels(householdId: string): Promise<Map<string, string>> {
    const rows = await db
      .select({
        id: householdMembers.id,
        name: householdMembers.name,
        legacyDisplayName: householdMembers.legacyDisplayName,
        email: users.email,
      })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, householdId));
    return new Map(rows.map((m) => [m.id, memberShownLabel(m)]));
  }

  /**
   * Which students the caller may see records for, and which of those they may edit.
   * Admins: everyone enrolled as a student. Staff: students in classes they manage.
   * Students: themselves, read-only. Observers: nobody.
   */
  async function recordScope(householdId: string, context: SchoolContext) {
    const classes = await db.select().from(schoolClasses).where(eq(schoolClasses.householdId, householdId));
    const mine = await memberEnrollmentsForHousehold(db, householdId, context.memberId);
    const managed = classes.filter(
      (cls) =>
        resolveClassAccess({
          memberId: context.memberId,
          householdRole: context.householdRole,
          teacherMemberId: cls.teacherMemberId,
          enrollment: mine.find((e) => e.classId === cls.id) ?? null,
        }).canManage,
    );

    const managedIds = managed.map((m) => m.id);
    const enrolled =
      managedIds.length > 0
        ? await db
            .select({ memberId: schoolEnrollments.memberId })
            .from(schoolEnrollments)
            .where(and(inArray(schoolEnrollments.classId, managedIds), eq(schoolEnrollments.role, "student")))
        : [];
    const editable = new Set(enrolled.map((e) => e.memberId));
    const viewable = new Set(editable);
    if (mine.some((e) => e.role === "student")) viewable.add(context.memberId);
    return { classes, managedClassIds: new Set(managedIds), editable, viewable };
  }

  // ---- attendance (per class) -------------------------------------------------------------

  async function classAccess(c: Ctx, context: SchoolContext, classId: string) {
    const auth = c.get("auth")!;
    const [cls] = await db
      .select()
      .from(schoolClasses)
      .where(and(eq(schoolClasses.id, classId), eq(schoolClasses.householdId, auth.householdId)))
      .limit(1);
    if (!cls) return null;
    const mine = await memberEnrollmentsForHousehold(db, auth.householdId, context.memberId);
    const access = resolveClassAccess({
      memberId: context.memberId,
      householdRole: context.householdRole,
      teacherMemberId: cls.teacherMemberId,
      enrollment: mine.find((e) => e.classId === classId) ?? null,
    });
    return { cls, access };
  }

  app.get("/classes/:classId/attendance", async (c) => {
    const context = await loadContext(c);
    if (context instanceof Response) return context;
    const range = rangeFromQuery(c);
    if ("error" in range) return c.json({ error: range.error }, 400);

    const found = await classAccess(c, context, c.req.param("classId"));
    if (!found) return c.json({ error: "not_found" }, 404);
    const { access } = found;
    const isStudent = access.enrollmentRole === "student";
    if (!access.canViewFullGradebook && !isStudent) return c.json({ error: "forbidden" }, 403);

    const conditions = [eq(schoolAttendance.classId, found.cls.id)];
    if (range.from) conditions.push(gte(schoolAttendance.attendanceDate, range.from));
    if (range.to) conditions.push(lte(schoolAttendance.attendanceDate, range.to));
    if (!access.canViewFullGradebook) {
      conditions.push(eq(schoolAttendance.studentMemberId, context.memberId));
    }
    const rows = await db
      .select({
        studentMemberId: schoolAttendance.studentMemberId,
        attendanceDate: schoolAttendance.attendanceDate,
        status: schoolAttendance.status,
        note: schoolAttendance.note,
      })
      .from(schoolAttendance)
      .where(and(...conditions))
      .orderBy(desc(schoolAttendance.attendanceDate));
    return c.json({ attendance: rows, canEdit: access.canGrade });
  });

  app.put("/classes/:classId/attendance", async (c) => {
    const context = await loadContext(c);
    if (context instanceof Response) return context;
    const auth = c.get("auth")!;

    const found = await classAccess(c, context, c.req.param("classId"));
    if (!found) return c.json({ error: "not_found" }, 404);
    if (!found.access.canGrade) return c.json({ error: "forbidden" }, 403);

    const body = await c.req
      .json<{
        date?: unknown;
        entries?: { studentMemberId?: unknown; status?: unknown; note?: unknown }[];
      }>()
      .catch(() => null);
    if (!body || !isIsoDate(body.date)) return c.json({ error: "invalid_date" }, 400);
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return c.json({ error: "invalid_entries" }, 400);
    }
    if (body.entries.length > MAX_ATTENDANCE_ENTRIES) return c.json({ error: "too_many_entries" }, 400);

    const enrolled = await db
      .select({ memberId: schoolEnrollments.memberId })
      .from(schoolEnrollments)
      .where(and(eq(schoolEnrollments.classId, found.cls.id), eq(schoolEnrollments.role, "student")));
    const studentIds = new Set(enrolled.map((e) => e.memberId));

    const upserts: { studentMemberId: string; status: AttendanceStatus; note: string }[] = [];
    const clears: string[] = [];
    for (const e of body.entries) {
      if (typeof e.studentMemberId !== "string" || !studentIds.has(e.studentMemberId)) {
        return c.json({ error: "invalid_student" }, 400);
      }
      // status null clears the mark (someone tapped the wrong day).
      if (e.status === null) {
        clears.push(e.studentMemberId);
        continue;
      }
      if (!isAttendanceStatus(e.status)) return c.json({ error: "invalid_status" }, 400);
      const note = typeof e.note === "string" ? e.note.slice(0, MAX_TEXT) : "";
      upserts.push({ studentMemberId: e.studentMemberId, status: e.status, note });
    }

    const date = body.date;
    await db.transaction(async (tx) => {
      if (clears.length > 0) {
        await tx
          .delete(schoolAttendance)
          .where(
            and(
              eq(schoolAttendance.classId, found.cls.id),
              eq(schoolAttendance.attendanceDate, date),
              inArray(schoolAttendance.studentMemberId, clears),
            ),
          );
      }
      for (const u of upserts) {
        await tx
          .insert(schoolAttendance)
          .values({
            classId: found.cls.id,
            studentMemberId: u.studentMemberId,
            attendanceDate: date,
            status: u.status,
            note: u.note,
            markedByUserId: auth.userId,
          })
          .onConflictDoUpdate({
            target: [
              schoolAttendance.classId,
              schoolAttendance.studentMemberId,
              schoolAttendance.attendanceDate,
            ],
            set: { status: u.status, note: u.note, markedByUserId: auth.userId },
          });
      }
    });
    return c.json({ ok: true, saved: upserts.length, cleared: clears.length });
  });

  // ---- records: who I can see, one student's attendance + hours -----------------------------

  app.get("/records/students", async (c) => {
    const context = await loadContext(c);
    if (context instanceof Response) return context;
    const auth = c.get("auth")!;
    const scope = await recordScope(auth.householdId, context);
    const labels = await memberLabels(auth.householdId);
    const students = [...scope.viewable]
      .map((memberId) => ({
        memberId,
        label: labels.get(memberId) ?? "Student",
        canEdit: scope.editable.has(memberId),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return c.json({ students });
  });

  /** Attendance rows for one student across household classes they may be seen in. */
  async function studentAttendance(
    studentMemberId: string,
    classIds: string[],
    range: { from?: string; to?: string },
  ) {
    if (classIds.length === 0) return [];
    const conditions = [
      eq(schoolAttendance.studentMemberId, studentMemberId),
      inArray(schoolAttendance.classId, classIds),
    ];
    if (range.from) conditions.push(gte(schoolAttendance.attendanceDate, range.from));
    if (range.to) conditions.push(lte(schoolAttendance.attendanceDate, range.to));
    return db
      .select({
        classId: schoolAttendance.classId,
        studentMemberId: schoolAttendance.studentMemberId,
        attendanceDate: schoolAttendance.attendanceDate,
        status: schoolAttendance.status,
      })
      .from(schoolAttendance)
      .where(and(...conditions));
  }

  async function studentHours(
    householdId: string,
    studentMemberId: string,
    range: { from?: string; to?: string },
  ) {
    const conditions = [
      eq(schoolHoursLog.householdId, householdId),
      eq(schoolHoursLog.studentMemberId, studentMemberId),
    ];
    if (range.from) conditions.push(gte(schoolHoursLog.logDate, range.from));
    if (range.to) conditions.push(lte(schoolHoursLog.logDate, range.to));
    return db
      .select({
        id: schoolHoursLog.id,
        classId: schoolHoursLog.classId,
        logDate: schoolHoursLog.logDate,
        minutes: schoolHoursLog.minutes,
        activity: schoolHoursLog.activity,
        note: schoolHoursLog.note,
      })
      .from(schoolHoursLog)
      .where(and(...conditions))
      .orderBy(desc(schoolHoursLog.logDate), desc(schoolHoursLog.createdAt));
  }

  app.get("/records/:studentMemberId", async (c) => {
    const context = await loadContext(c);
    if (context instanceof Response) return context;
    const auth = c.get("auth")!;
    const range = rangeFromQuery(c);
    if ("error" in range) return c.json({ error: range.error }, 400);
    const studentMemberId = c.req.param("studentMemberId");

    const scope = await recordScope(auth.householdId, context);
    if (!scope.viewable.has(studentMemberId)) return c.json({ error: "not_found" }, 404);

    const enrollmentRows = await db
      .select({ classId: schoolEnrollments.classId })
      .from(schoolEnrollments)
      .where(and(eq(schoolEnrollments.memberId, studentMemberId), eq(schoolEnrollments.role, "student")));
    const classById = new Map(scope.classes.map((cls) => [cls.id, cls]));
    // Staff see only classes they manage; the student and admins see all of the student's classes.
    const seeAll = studentMemberId === context.memberId || isHouseholdAdmin(context.householdRole);
    const classIds = enrollmentRows
      .map((e) => e.classId)
      .filter((id) => classById.has(id) && (seeAll || scope.managedClassIds.has(id)));

    const attendanceRows = await studentAttendance(studentMemberId, classIds, range);
    const hours = await studentHours(auth.householdId, studentMemberId, range);
    const labels = await memberLabels(auth.householdId);

    const perClass = classIds.map((id) => ({
      classId: id,
      className: classById.get(id)!.name,
      ...tallyAttendance(attendanceRows.filter((r) => r.classId === id)),
    }));
    const minutes = totalMinutes(hours);

    return c.json({
      student: { memberId: studentMemberId, label: labels.get(studentMemberId) ?? "Student" },
      canEdit: scope.editable.has(studentMemberId),
      classes: classIds.map((id) => ({ id, name: classById.get(id)!.name })),
      attendance: { days: summarizeSchoolDays(attendanceRows), perClass },
      hours: { entries: hours, totalMinutes: minutes, totalHours: minutesToHours(minutes) },
    });
  });

  // ---- hours log ----------------------------------------------------------------------------

  async function parseHoursBody(
    c: Ctx,
    householdId: string,
    partial: boolean,
  ): Promise<
    | { error: string }
    | {
        classId?: string | null;
        logDate?: string;
        minutes?: number;
        activity?: string;
        note?: string;
        studentMemberId?: string;
      }
  > {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return { error: "invalid_body" };
    const out: {
      classId?: string | null;
      logDate?: string;
      minutes?: number;
      activity?: string;
      note?: string;
      studentMemberId?: string;
    } = {};

    if (!partial || body.logDate !== undefined) {
      if (!isIsoDate(body.logDate)) return { error: "invalid_date" };
      out.logDate = body.logDate;
    }
    if (!partial || body.minutes !== undefined) {
      const minutes = parseMinutes(body.minutes);
      if (minutes === null) return { error: "invalid_minutes" };
      out.minutes = minutes;
    }
    if (body.activity !== undefined) {
      if (typeof body.activity !== "string") return { error: "invalid_activity" };
      out.activity = body.activity.trim().slice(0, 128);
    }
    if (body.note !== undefined) {
      if (typeof body.note !== "string") return { error: "invalid_note" };
      out.note = body.note.slice(0, MAX_TEXT);
    }
    if (body.classId !== undefined) {
      if (body.classId === null) {
        out.classId = null;
      } else if (typeof body.classId === "string") {
        const [cls] = await db
          .select({ id: schoolClasses.id })
          .from(schoolClasses)
          .where(and(eq(schoolClasses.id, body.classId), eq(schoolClasses.householdId, householdId)))
          .limit(1);
        if (!cls) return { error: "invalid_class" };
        out.classId = cls.id;
      } else {
        return { error: "invalid_class" };
      }
    }
    if (typeof body.studentMemberId === "string") out.studentMemberId = body.studentMemberId;
    return out;
  }

  app.post("/hours", async (c) => {
    const context = await loadContext(c);
    if (context instanceof Response) return context;
    const auth = c.get("auth")!;
    const parsed = await parseHoursBody(c, auth.householdId, false);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    if (!parsed.studentMemberId) return c.json({ error: "invalid_student" }, 400);

    const scope = await recordScope(auth.householdId, context);
    if (!scope.editable.has(parsed.studentMemberId)) return c.json({ error: "forbidden" }, 403);

    const [row] = await db
      .insert(schoolHoursLog)
      .values({
        householdId: auth.householdId,
        studentMemberId: parsed.studentMemberId,
        classId: parsed.classId ?? null,
        logDate: parsed.logDate!,
        minutes: parsed.minutes!,
        activity: parsed.activity ?? "",
        note: parsed.note ?? "",
        createdByUserId: auth.userId,
      })
      .returning();
    return c.json({ entry: row }, 201);
  });

  async function editableHoursRow(c: Ctx, context: SchoolContext, id: string) {
    const auth = c.get("auth")!;
    const [row] = await db
      .select()
      .from(schoolHoursLog)
      .where(and(eq(schoolHoursLog.id, id), eq(schoolHoursLog.householdId, auth.householdId)))
      .limit(1);
    if (!row) return { status: 404 as const };
    const scope = await recordScope(auth.householdId, context);
    if (!scope.editable.has(row.studentMemberId)) return { status: 403 as const };
    return { row };
  }

  app.patch("/hours/:id", async (c) => {
    const context = await loadContext(c);
    if (context instanceof Response) return context;
    const auth = c.get("auth")!;
    const target = await editableHoursRow(c, context, c.req.param("id"));
    if ("status" in target) {
      return c.json({ error: target.status === 404 ? "not_found" : "forbidden" }, target.status);
    }
    const parsed = await parseHoursBody(c, auth.householdId, true);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const { studentMemberId: _ignored, ...patch } = parsed;
    if (Object.keys(patch).length === 0) return c.json({ error: "empty_patch" }, 400);
    const [row] = await db
      .update(schoolHoursLog)
      .set(patch)
      .where(and(eq(schoolHoursLog.id, target.row.id), eq(schoolHoursLog.householdId, auth.householdId)))
      .returning();
    return c.json({ entry: row });
  });

  app.delete("/hours/:id", async (c) => {
    const context = await loadContext(c);
    if (context instanceof Response) return context;
    const auth = c.get("auth")!;
    const target = await editableHoursRow(c, context, c.req.param("id"));
    if ("status" in target) {
      return c.json({ error: target.status === 404 ? "not_found" : "forbidden" }, target.status);
    }
    await db
      .delete(schoolHoursLog)
      .where(and(eq(schoolHoursLog.id, target.row.id), eq(schoolHoursLog.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  // ---- transcript ---------------------------------------------------------------------------

  app.get("/transcript/:studentMemberId", async (c) => {
    const context = await loadContext(c);
    if (context instanceof Response) return context;
    const auth = c.get("auth")!;
    const range = rangeFromQuery(c);
    if ("error" in range) return c.json({ error: range.error }, 400);
    const studentMemberId = c.req.param("studentMemberId");

    const scope = await recordScope(auth.householdId, context);
    if (!scope.viewable.has(studentMemberId)) return c.json({ error: "not_found" }, 404);
    const seeAll = studentMemberId === context.memberId || isHouseholdAdmin(context.householdRole);

    const enrollmentRows = await db
      .select({ classId: schoolEnrollments.classId })
      .from(schoolEnrollments)
      .where(and(eq(schoolEnrollments.memberId, studentMemberId), eq(schoolEnrollments.role, "student")));
    const classById = new Map(scope.classes.map((cls) => [cls.id, cls]));
    const courses = [...new Set(enrollmentRows.map((e) => e.classId))]
      .filter((id) => classById.has(id) && (seeAll || scope.managedClassIds.has(id)))
      .map((id) => classById.get(id)!);

    const categoryRows =
      courses.length > 0
        ? await db
            .select()
            .from(schoolAssignmentCategories)
            .where(
              inArray(
                schoolAssignmentCategories.classId,
                courses.map((cls) => cls.id),
              ),
            )
            .orderBy(asc(schoolAssignmentCategories.name))
        : [];

    const inputs = [];
    for (const cls of courses) {
      // includeInactive: past years' enrollments have ended but still belong on the transcript.
      const gradebook = await buildClassGradebook(db, cls.id, new Date(), { includeInactive: true });
      const row = gradebook.students.find((s) => s.memberId === studentMemberId);
      const assignmentInputs = gradebook.assignments.map((a) => ({
        id: a.id,
        title: a.title,
        categoryId: a.categoryId,
        pointsPossible: a.pointsPossible,
        visibility: a.visibility,
        dueAt: a.dueAt,
      }));
      const cells = (row?.cells ?? []).map((cell) => ({
        assignmentId: cell.assignmentId,
        status: cell.status,
        score: cell.score,
        gradedAt: cell.gradedAt,
      }));
      const categories = categoryRows
        .filter((cat) => cat.classId === cls.id)
        .map((cat) => ({ id: cat.id, name: cat.name, weightPercent: cat.weightPercent }));
      const weighted = computeWeightedGrade(categories, assignmentInputs, cells).weightedAveragePercent;
      inputs.push({
        classId: cls.id,
        name: cls.name,
        subject: cls.subject,
        term: cls.term,
        credits: cls.credits,
        finalPercent: weighted ?? computePointsAverage(assignmentInputs, cells),
      });
    }

    const classIds = courses.map((cls) => cls.id);
    const attendanceRows = await studentAttendance(studentMemberId, classIds, range);
    const hours = await studentHours(auth.householdId, studentMemberId, range);
    const minutes = totalMinutes(hours);
    const labels = await memberLabels(auth.householdId);
    const [household] = await db
      .select({ name: households.name })
      .from(households)
      .where(eq(households.id, auth.householdId))
      .limit(1);

    return c.json({
      student: { memberId: studentMemberId, label: labels.get(studentMemberId) ?? "Student" },
      householdName: household?.name ?? "",
      range: { from: range.from ?? null, to: range.to ?? null },
      transcript: buildTranscript(inputs),
      attendance: summarizeSchoolDays(attendanceRows),
      hours: { totalMinutes: minutes, totalHours: minutesToHours(minutes) },
      generatedAt: new Date().toISOString(),
    });
  });

  return app;
}
