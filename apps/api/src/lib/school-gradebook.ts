import type { Database } from "@domi-ops/db";
import {
  schoolAssignments,
  schoolEnrollments,
  schoolGrades,
  schoolSubmissions,
} from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import { isEnrollmentActiveNow } from "./school-access.js";

export type GradebookCellStatus =
  | "missing"
  | "overdue"
  | "submitted"
  | "graded"
  | "not_assigned";

export interface GradebookAssignmentColumn {
  id: string;
  title: string;
  dueAt: string | null;
  pointsPossible: number;
  visibility: string;
  categoryId: string | null;
}

export interface GradebookStudentCell {
  assignmentId: string;
  status: GradebookCellStatus;
  score: number | null;
  percent: number | null;
  missing: boolean;
  overdue: boolean;
  gradedAt: string | null;
}

export interface GradebookStudentRow {
  memberId: string;
  enrollmentId: string;
  cells: GradebookStudentCell[];
  gradedCount: number;
  missingCount: number;
  overdueCount: number;
  averagePercent: number | null;
}

export interface GradebookSummary {
  assignmentCount: number;
  studentCount: number;
  missingTotal: number;
  overdueTotal: number;
  gradedTotal: number;
  classAveragePercent: number | null;
}

export interface GradebookData {
  summary: GradebookSummary;
  assignments: GradebookAssignmentColumn[];
  students: GradebookStudentRow[];
}

export function gradebookCell(params: {
  visibility: string;
  dueAt: Date | null;
  pointsPossible: number;
  submissionStatus: string | null;
  score: number | null;
  now: Date;
}): {
  status: GradebookCellStatus;
  score: number | null;
  percent: number | null;
  missing: boolean;
  overdue: boolean;
} {
  const { visibility, dueAt, pointsPossible, submissionStatus, score, now } = params;
  if (visibility === "draft") {
    return {
      status: "not_assigned",
      score: null,
      percent: null,
      missing: false,
      overdue: false,
    };
  }

  const submitted =
    submissionStatus === "submitted" || submissionStatus === "graded" || submissionStatus === "returned";
  const graded = submissionStatus === "graded" || score != null;
  const overdue = Boolean(dueAt && dueAt < now && !submitted && !graded);
  const missing = !submitted && !graded;

  let status: GradebookCellStatus;
  if (graded) status = "graded";
  else if (submitted) status = "submitted";
  else if (overdue) status = "overdue";
  else if (missing) status = "missing";
  else status = "not_assigned";

  const percent =
    score != null && pointsPossible > 0 ? Math.round((score / pointsPossible) * 1000) / 10 : null;

  return { status, score, percent, missing, overdue };
}

export async function buildClassGradebook(
  db: Database,
  classId: string,
  now = new Date(),
): Promise<GradebookData> {
  const enrollmentRows = await db
    .select()
    .from(schoolEnrollments)
    .where(eq(schoolEnrollments.classId, classId));

  const studentEnrollments = enrollmentRows.filter(
    (e) => e.role === "student" && isEnrollmentActiveNow(e.activeFrom, e.activeTo),
  );

  const assignmentRows = await db
    .select()
    .from(schoolAssignments)
    .where(
      and(
        eq(schoolAssignments.classId, classId),
        inArray(schoolAssignments.visibility, ["assigned", "closed", "draft"]),
      ),
    );

  const visibleAssignments = assignmentRows.filter((a) => a.visibility !== "draft");
  const assignmentIds = assignmentRows.map((a) => a.id);

  let submissionRows: (typeof schoolSubmissions.$inferSelect)[] = [];
  if (assignmentIds.length > 0) {
    submissionRows = await db
      .select()
      .from(schoolSubmissions)
      .where(inArray(schoolSubmissions.assignmentId, assignmentIds));
  }

  const submissionIds = submissionRows.map((s) => s.id);
  let gradeRows: (typeof schoolGrades.$inferSelect)[] = [];
  if (submissionIds.length > 0) {
    gradeRows = await db
      .select()
      .from(schoolGrades)
      .where(inArray(schoolGrades.submissionId, submissionIds));
  }

  const gradeBySubmission = new Map(gradeRows.map((g) => [g.submissionId, g]));
  const submissionByKey = new Map(
    submissionRows.map((s) => [`${s.assignmentId}:${s.studentMemberId}`, s]),
  );

  const assignments = assignmentRows.map((a) => ({
    id: a.id,
    title: a.title,
    dueAt: a.dueAt?.toISOString() ?? null,
    pointsPossible: a.pointsPossible,
    visibility: a.visibility,
    categoryId: a.categoryId ?? null,
  }));

  let missingTotal = 0;
  let overdueTotal = 0;
  let gradedTotal = 0;
  const studentAverages: number[] = [];

  const students = studentEnrollments.map((enrollment) => {
    let gradedCount = 0;
    let missingCount = 0;
    let overdueCount = 0;
    let pointsEarned = 0;
    let pointsGraded = 0;

    const cells = assignmentRows.map((assignment) => {
      const submission = submissionByKey.get(`${assignment.id}:${enrollment.memberId}`) ?? null;
      const grade = submission ? (gradeBySubmission.get(submission.id) ?? null) : null;
      const cell = gradebookCell({
        visibility: assignment.visibility,
        dueAt: assignment.dueAt,
        pointsPossible: assignment.pointsPossible,
        submissionStatus: submission?.status ?? null,
        score: grade?.score ?? null,
        now,
      });

      if (assignment.visibility !== "draft") {
        if (cell.missing) missingCount += 1;
        if (cell.overdue) overdueCount += 1;
        if (cell.status === "graded" && cell.score != null) {
          gradedCount += 1;
          pointsEarned += cell.score;
          pointsGraded += assignment.pointsPossible;
        }
      }

      return {
        assignmentId: assignment.id,
        status: cell.status,
        score: cell.score,
        percent: cell.percent,
        missing: cell.missing,
        overdue: cell.overdue,
        gradedAt: grade?.gradedAt?.toISOString() ?? null,
      };
    });

    missingTotal += missingCount;
    overdueTotal += overdueCount;
    gradedTotal += gradedCount;

    const averagePercent =
      pointsGraded > 0 ? Math.round((pointsEarned / pointsGraded) * 1000) / 10 : null;
    if (averagePercent != null) studentAverages.push(averagePercent);

    return {
      memberId: enrollment.memberId,
      enrollmentId: enrollment.id,
      cells,
      gradedCount,
      missingCount,
      overdueCount,
      averagePercent,
    };
  });

  const classAveragePercent =
    studentAverages.length > 0
      ? Math.round(
          (studentAverages.reduce((sum, v) => sum + v, 0) / studentAverages.length) * 10,
        ) / 10
      : null;

  return {
    summary: {
      assignmentCount: visibleAssignments.length,
      studentCount: studentEnrollments.length,
      missingTotal,
      overdueTotal,
      gradedTotal,
      classAveragePercent,
    },
    assignments,
    students,
  };
}
