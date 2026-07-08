import type { Database } from "@domi-ops/db";
import {
  importRecords,
  schoolAssignmentCategories,
  schoolAssignments,
  schoolAttendance,
  schoolClasses,
  schoolEnrollments,
  schoolGrades,
  schoolSubmissionArtifacts,
  schoolSubmissions,
} from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import { requireDb } from "../lib/require-db.js";
import { defaultTeacherMemberId, resolveMemberId, resolveOrCreateSchoolStudent } from "../lib/member-resolve.js";
import { sqliteTableExists } from "../lib/sqlite.js";
import type { ImportContext, MapperResult } from "./types.js";

const VISIBILITY = new Set(["draft", "assigned", "closed"]);
const SUBMISSION_STATUS = new Set(["not_started", "submitted", "graded", "returned"]);
const ATTENDANCE_STATUS = new Set(["present", "absent", "late", "excused"]);

function mapVisibility(raw: unknown): "draft" | "assigned" | "closed" {
  const v = String(raw ?? "assigned").toLowerCase();
  if (VISIBILITY.has(v)) return v as "draft" | "assigned" | "closed";
  return "assigned";
}

function mapSubmissionStatus(raw: unknown): "not_started" | "submitted" | "graded" | "returned" {
  const v = String(raw ?? "not_started").toLowerCase();
  if (SUBMISSION_STATUS.has(v)) return v as "not_started" | "submitted" | "graded" | "returned";
  return "not_started";
}

function mapAttendanceStatus(raw: unknown): "present" | "absent" | "late" | "excused" {
  const v = String(raw ?? "present").toLowerCase();
  if (ATTENDANCE_STATUS.has(v)) return v as "present" | "absent" | "late" | "excused";
  return "present";
}

async function resolveStudentMemberId(
  db: Database,
  ctx: ImportContext,
  label: string,
  cache: Map<string, string>,
): Promise<string | null> {
  let memberId = await resolveMemberId(db, ctx.householdId, label, cache);
  if (memberId) return memberId;

  const directory = ctx.memberDirectory.get(label.trim().toLowerCase());
  const created = await resolveOrCreateSchoolStudent(
    db,
    ctx.householdId,
    label,
    cache,
    directory,
  );
  return created?.memberId ?? null;
}

/** Returns prior import target id so re-import runs can resolve FKs via `ctx.idMap`. */
async function lookupImportTarget(
  db: Database,
  householdId: string,
  sourceTable: string,
  sourceId: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ targetId: importRecords.targetId })
    .from(importRecords)
    .where(
      and(
        eq(importRecords.householdId, householdId),
        eq(importRecords.sourceTable, sourceTable),
        eq(importRecords.sourceId, sourceId),
      ),
    )
    .limit(1);
  return existing?.targetId ?? null;
}

export async function importSchool(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  let classCount = 0;
  try {
    const row = ctx.sqlite
      .prepare("SELECT COUNT(*) as c FROM school_class")
      .get() as { c: number };
    classCount = row?.c ?? 0;
  } catch {
    result.warnings.push("school_class table not found — skipped");
    return result;
  }

  if (ctx.dryRun) {
    const tables = [
      "school_enrollment",
      "school_assignment_category",
      "school_assignment",
      "school_submission",
      "school_grade_entry",
      "school_attendance",
      "school_submission_artifact",
    ];
    let total = classCount;
    for (const t of tables) {
      try {
        const r = ctx.sqlite.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number };
        total += r?.c ?? 0;
      } catch {
        /* optional table */
      }
    }
    result.imported = total;
    return result;
  }

  const db = requireDb(ctx);
  const memberCache = new Map<string, string>();
  const fallbackTeacher = await defaultTeacherMemberId(db, ctx.householdId);
  if (!fallbackTeacher) {
    result.warnings.push("no household members — cannot import school");
    return result;
  }

  const classes = ctx.sqlite
    .prepare(
      `SELECT id, name, subject, term, teacher_id, schedule_json, archived
       FROM school_class ORDER BY id`,
    )
    .all() as Record<string, unknown>[];

  for (const row of classes) {
    const sourceId = String(row.id);
    const existingClassId = await lookupImportTarget(db, ctx.householdId, "school_class", sourceId);
    if (existingClassId) {
      ctx.idMap.set(`school_class:${sourceId}`, existingClassId);
      result.skipped++;
      continue;
    }
    let teacherMemberId = await resolveMemberId(
      db,
      ctx.householdId,
      String(row.teacher_id ?? ""),
      memberCache,
    );
    if (!teacherMemberId) {
      teacherMemberId = fallbackTeacher;
      result.warnings.push(`school_class ${sourceId}: teacher "${row.teacher_id}" not mapped, using fallback`);
    }

    const [created] = await db
      .insert(schoolClasses)
      .values({
        householdId: ctx.householdId,
        name: String(row.name),
        subject: row.subject ? String(row.subject) : null,
        term: row.term ? String(row.term) : null,
        teacherMemberId,
        scheduleJson: String(row.schedule_json ?? "{}"),
        archived: Boolean(row.archived),
      })
      .returning();
    ctx.idMap.set(`school_class:${sourceId}`, created.id);
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "school_class",
      sourceId,
      targetTable: "school_classes",
      targetId: created.id,
    });
    result.imported++;
  }

  const enrollments = sqliteTableExists(ctx.sqlite, "school_enrollment")
    ? (ctx.sqlite
        .prepare(
          `SELECT id, class_id, student_id, role, active_from, active_to FROM school_enrollment ORDER BY id`,
        )
        .all() as Record<string, unknown>[])
    : [];

  for (const row of enrollments) {
    const sourceId = String(row.id);
    if (await lookupImportTarget(db, ctx.householdId, "school_enrollment", sourceId)) {
      result.skipped++;
      continue;
    }
    const classId = ctx.idMap.get(`school_class:${row.class_id}`);
    if (!classId) {
      result.warnings.push(`enrollment ${sourceId}: unknown class_id ${row.class_id}`);
      continue;
    }
    let memberId = await resolveStudentMemberId(
      db,
      ctx,
      String(row.student_id ?? ""),
      memberCache,
    );
    if (!memberId) {
      result.warnings.push(`enrollment ${sourceId}: student "${row.student_id}" not mapped`);
      continue;
    }
    const [enr] = await db
      .insert(schoolEnrollments)
      .values({
        classId,
        memberId,
        role: String(row.role ?? "student"),
        activeFrom: row.active_from ? String(row.active_from).slice(0, 10) : null,
        activeTo: row.active_to ? String(row.active_to).slice(0, 10) : null,
      })
      .returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "school_enrollment",
      sourceId,
      targetTable: "school_enrollments",
      targetId: enr.id,
    });
    result.imported++;
  }

  const categories = sqliteTableExists(ctx.sqlite, "school_assignment_category")
    ? (ctx.sqlite
        .prepare(
          `SELECT id, class_id, name, weight_percent, grading_policy FROM school_assignment_category ORDER BY id`,
        )
        .all() as Record<string, unknown>[])
    : [];

  for (const row of categories) {
    const sourceId = String(row.id);
    const existingCategoryId = await lookupImportTarget(
      db,
      ctx.householdId,
      "school_assignment_category",
      sourceId,
    );
    if (existingCategoryId) {
      ctx.idMap.set(`school_assignment_category:${sourceId}`, existingCategoryId);
      result.skipped++;
      continue;
    }
    const classId = row.class_id ? ctx.idMap.get(`school_class:${row.class_id}`) : null;
    if (row.class_id && !classId) {
      result.warnings.push(`category ${sourceId}: unknown class_id ${row.class_id}`);
      continue;
    }
    const [cat] = await db
      .insert(schoolAssignmentCategories)
      .values({
        classId: classId ?? null,
        name: String(row.name),
        weightPercent: Number(row.weight_percent ?? 0),
        gradingPolicy: String(row.grading_policy ?? "points"),
      })
      .returning();
    ctx.idMap.set(`school_assignment_category:${sourceId}`, cat.id);
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "school_assignment_category",
      sourceId,
      targetTable: "school_assignment_categories",
      targetId: cat.id,
    });
    result.imported++;
  }

  const assignments = sqliteTableExists(ctx.sqlite, "school_assignment")
    ? (ctx.sqlite
        .prepare(
          `SELECT id, class_id, category_id, title, instructions_html, due_at, points_possible,
                  allow_late, visibility, status FROM school_assignment ORDER BY id`,
        )
        .all() as Record<string, unknown>[])
    : [];

  for (const row of assignments) {
    const sourceId = String(row.id);
    const existingAssignmentId = await lookupImportTarget(
      db,
      ctx.householdId,
      "school_assignment",
      sourceId,
    );
    if (existingAssignmentId) {
      ctx.idMap.set(`school_assignment:${sourceId}`, existingAssignmentId);
      result.skipped++;
      continue;
    }
    const classId = ctx.idMap.get(`school_class:${row.class_id}`);
    if (!classId) {
      result.warnings.push(`assignment ${sourceId}: unknown class_id ${row.class_id}`);
      continue;
    }
    const categoryId = row.category_id
      ? ctx.idMap.get(`school_assignment_category:${row.category_id}`)
      : null;
    const visibility = mapVisibility(row.visibility ?? row.status);
    const [asn] = await db
      .insert(schoolAssignments)
      .values({
        classId,
        categoryId: categoryId ?? null,
        title: String(row.title),
        instructionsHtml: String(row.instructions_html ?? ""),
        dueAt: row.due_at ? new Date(String(row.due_at)) : null,
        pointsPossible: Number(row.points_possible ?? 100),
        allowLate: Boolean(row.allow_late ?? true),
        visibility,
      })
      .returning();
    ctx.idMap.set(`school_assignment:${sourceId}`, asn.id);
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "school_assignment",
      sourceId,
      targetTable: "school_assignments",
      targetId: asn.id,
    });
    result.imported++;
  }

  const submissions = sqliteTableExists(ctx.sqlite, "school_submission")
    ? (ctx.sqlite
        .prepare(
          `SELECT id, assignment_id, student_id, status, submitted_at, is_late, attempt_number, student_note
           FROM school_submission ORDER BY id`,
        )
        .all() as Record<string, unknown>[])
    : [];

  for (const row of submissions) {
    const sourceId = String(row.id);
    const existingSubmissionId = await lookupImportTarget(
      db,
      ctx.householdId,
      "school_submission",
      sourceId,
    );
    if (existingSubmissionId) {
      ctx.idMap.set(`school_submission:${sourceId}`, existingSubmissionId);
      result.skipped++;
      continue;
    }
    const assignmentId = ctx.idMap.get(`school_assignment:${row.assignment_id}`);
    if (!assignmentId) {
      result.warnings.push(`submission ${sourceId}: unknown assignment_id ${row.assignment_id}`);
      continue;
    }
    const studentMemberId = await resolveStudentMemberId(
      db,
      ctx,
      String(row.student_id ?? ""),
      memberCache,
    );
    if (!studentMemberId) {
      result.warnings.push(`submission ${sourceId}: student "${row.student_id}" not mapped`);
      continue;
    }
    const [sub] = await db
      .insert(schoolSubmissions)
      .values({
        assignmentId,
        studentMemberId,
        status: mapSubmissionStatus(row.status),
        submittedAt: row.submitted_at ? new Date(String(row.submitted_at)) : null,
        isLate: Boolean(row.is_late),
        attemptNumber: String(row.attempt_number ?? "1"),
        studentNote: String(row.student_note ?? ""),
      })
      .returning();
    ctx.idMap.set(`school_submission:${sourceId}`, sub.id);
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "school_submission",
      sourceId,
      targetTable: "school_submissions",
      targetId: sub.id,
    });
    result.imported++;
  }

  const grades = sqliteTableExists(ctx.sqlite, "school_grade_entry")
    ? (ctx.sqlite
        .prepare(
          `SELECT id, submission_id, score, feedback_html, graded_by, graded_at, revision_requested
           FROM school_grade_entry ORDER BY id`,
        )
        .all() as Record<string, unknown>[])
    : [];

  for (const row of grades) {
    const sourceId = String(row.id);
    if (await lookupImportTarget(db, ctx.householdId, "school_grade_entry", sourceId)) {
      result.skipped++;
      continue;
    }
    const submissionId = ctx.idMap.get(`school_submission:${row.submission_id}`);
    if (!submissionId) {
      result.warnings.push(`grade ${sourceId}: unknown submission_id ${row.submission_id}`);
      continue;
    }
    const [grade] = await db
      .insert(schoolGrades)
      .values({
        submissionId,
        score: row.score != null ? Number(row.score) : null,
        feedbackHtml: String(row.feedback_html ?? ""),
        gradedAt: row.graded_at ? new Date(String(row.graded_at)) : null,
        revisionRequested: Boolean(row.revision_requested),
      })
      .returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "school_grade_entry",
      sourceId,
      targetTable: "school_grades",
      targetId: grade.id,
    });
    result.imported++;
  }

  if (sqliteTableExists(ctx.sqlite, "school_submission_artifact")) {
    const artifacts = ctx.sqlite
      .prepare(
        `SELECT id, submission_id, artifact_type, file_id, url, note
         FROM school_submission_artifact ORDER BY id`,
      )
      .all() as Record<string, unknown>[];

    for (const row of artifacts) {
      const sourceId = String(row.id);
      if (await lookupImportTarget(db, ctx.householdId, "school_submission_artifact", sourceId)) {
        result.skipped++;
        continue;
      }
      const submissionId = ctx.idMap.get(`school_submission:${row.submission_id}`);
      if (!submissionId) {
        result.warnings.push(`artifact ${sourceId}: unknown submission_id ${row.submission_id}`);
        continue;
      }
      const artifactType = String(row.artifact_type ?? "file");
      const fileKey =
        row.file_id != null ? ctx.idMap.get(`file:${row.file_id}`) : undefined;
      const [art] = await db
        .insert(schoolSubmissionArtifacts)
        .values({
          submissionId,
          artifactType,
          s3Key: fileKey ?? null,
          url: row.url ? String(row.url) : null,
          note: String(row.note ?? ""),
        })
        .returning();
      await db.insert(importRecords).values({
        householdId: ctx.householdId,
        sourceTable: "school_submission_artifact",
        sourceId,
        targetTable: "school_submission_artifacts",
        targetId: art.id,
      });
      result.imported++;
    }
  }

  if (sqliteTableExists(ctx.sqlite, "school_attendance")) {
    const attendance = ctx.sqlite
      .prepare(
        `SELECT id, class_id, student_id, attendance_date, status, note FROM school_attendance ORDER BY id`,
      )
      .all() as Record<string, unknown>[];

    for (const row of attendance) {
      const sourceId = String(row.id);
      if (await lookupImportTarget(db, ctx.householdId, "school_attendance", sourceId)) {
        result.skipped++;
        continue;
      }
      const classId = ctx.idMap.get(`school_class:${row.class_id}`);
      const studentMemberId = await resolveStudentMemberId(
        db,
        ctx,
        String(row.student_id ?? ""),
        memberCache,
      );
      if (!classId || !studentMemberId) {
        result.warnings.push(
          `attendance ${sourceId}: missing class or student mapping (class=${row.class_id}, student=${row.student_id})`,
        );
        continue;
      }
      const [att] = await db
        .insert(schoolAttendance)
        .values({
          classId,
          studentMemberId,
          attendanceDate: String(row.attendance_date).slice(0, 10),
          status: mapAttendanceStatus(row.status),
          note: String(row.note ?? ""),
        })
        .returning();
      await db.insert(importRecords).values({
        householdId: ctx.householdId,
        sourceTable: "school_attendance",
        sourceId,
        targetTable: "school_attendance",
        targetId: att.id,
      });
      result.imported++;
    }
  }

  return result;
}
