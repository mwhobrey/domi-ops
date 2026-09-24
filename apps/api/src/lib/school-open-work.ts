import { memberShownLabel } from "@domi-ops/auth";
import type { Database } from "@domi-ops/db";
import {
  householdMembers,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolGrades,
  schoolSubmissions,
} from "@domi-ops/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { isEnrollmentActiveNow } from "./school-access.js";
import { gradebookCell } from "./school-gradebook.js";

export type OpenWorkFilter = "due" | "overdue";

export type OpenWorkAssignment = {
  id: string;
  visibility: string;
  dueAt: Date;
  pointsPossible: number;
};

export type StudentWorkState = { submissionStatus: string | null; score: number | null };

/**
 * Which students still owe an assignment, and whether it belongs on the Due or Overdue list.
 * Uses the gradebook's rules, so anything turned in or graded is never "overdue". Closed
 * assignments drop off both lists — closing is how stale work is cleared. A class with no enrolled students still lists upcoming work, but never overdue work
 * (there's nobody it could be missing from).
 */
export function openWorkForAssignment(params: {
  assignment: OpenWorkAssignment;
  studentIds: string[];
  workByStudent: Map<string, StudentWorkState>;
  filter: OpenWorkFilter;
  now: Date;
  weekAhead: Date;
}): { include: boolean; owedBy: string[] } {
  const { assignment, studentIds, workByStudent, filter, now, weekAhead } = params;
  if (assignment.visibility !== "assigned") return { include: false, owedBy: [] };

  const pastDue = assignment.dueAt < now;
  if (filter === "overdue" ? !pastDue : pastDue || assignment.dueAt > weekAhead) {
    return { include: false, owedBy: [] };
  }

  const owedBy = studentIds.filter((memberId) => {
    const work = workByStudent.get(memberId);
    const cell = gradebookCell({
      visibility: assignment.visibility,
      dueAt: assignment.dueAt,
      pointsPossible: assignment.pointsPossible,
      submissionStatus: work?.submissionStatus ?? null,
      score: work?.score ?? null,
      now,
    });
    return filter === "overdue" ? cell.overdue : cell.missing;
  });

  if (filter === "overdue") return { include: owedBy.length > 0, owedBy };
  return { include: owedBy.length > 0 || studentIds.length === 0, owedBy };
}

/** Best state across attempts: any turned-in attempt beats "not started"; a score beats none. */
export function mergeStudentWork(
  current: StudentWorkState | undefined,
  next: StudentWorkState,
): StudentWorkState {
  if (!current) return next;
  const rank = (s: string | null) =>
    s === "graded" ? 3 : s === "returned" ? 2 : s === "submitted" ? 1 : 0;
  return {
    submissionStatus:
      rank(next.submissionStatus) > rank(current.submissionStatus)
        ? next.submissionStatus
        : current.submissionStatus,
    score: current.score ?? next.score,
  };
}

export type OpenWorkItem = {
  id: string;
  title: string;
  dueAt: string;
  overdue: boolean;
  visibility: string;
  pointsPossible: number;
  classId: string;
  className: string;
  classSubject: string | null;
  classTerm: string | null;
  /** Students who still owe this assignment. */
  students: { memberId: string; label: string }[];
};

type OpenWorkParams = {
  householdId: string;
  classIds: string[];
  onlyStudentId?: string | null;
  now?: Date;
};

/**
 * Open school work across `classIds`, per student. `onlyStudentId` narrows to one student
 * (a student viewing their own list).
 */
export async function listOpenWork(
  db: Database,
  params: OpenWorkParams & { filter: OpenWorkFilter },
): Promise<OpenWorkItem[]> {
  const lists = await loadOpenWorkLists(db, params);
  return lists[params.filter];
}

/** Due and overdue lists from one set of queries (the dashboard tile needs both). */
export async function loadOpenWorkLists(
  db: Database,
  params: OpenWorkParams,
): Promise<Record<OpenWorkFilter, OpenWorkItem[]>> {
  const { householdId, classIds, onlyStudentId } = params;
  const lists: Record<OpenWorkFilter, OpenWorkItem[]> = { due: [], overdue: [] };
  if (classIds.length === 0) return lists;
  const now = params.now ?? new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

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
        eq(schoolClasses.householdId, householdId),
        inArray(schoolClasses.id, classIds),
        isNotNull(schoolAssignments.dueAt),
        eq(schoolAssignments.visibility, "assigned"),
      ),
    );
  if (rows.length === 0) return lists;

  const enrollmentRows = await db
    .select({
      classId: schoolEnrollments.classId,
      memberId: schoolEnrollments.memberId,
      activeFrom: schoolEnrollments.activeFrom,
      activeTo: schoolEnrollments.activeTo,
    })
    .from(schoolEnrollments)
    .where(and(inArray(schoolEnrollments.classId, classIds), eq(schoolEnrollments.role, "student")));
  const studentsByClass = new Map<string, string[]>();
  for (const e of enrollmentRows) {
    if (!isEnrollmentActiveNow(e.activeFrom, e.activeTo)) continue;
    if (onlyStudentId && e.memberId !== onlyStudentId) continue;
    studentsByClass.set(e.classId, [...(studentsByClass.get(e.classId) ?? []), e.memberId]);
  }

  const assignmentIds = rows.map((r) => r.id);
  const submissionRows = await db
    .select({
      id: schoolSubmissions.id,
      assignmentId: schoolSubmissions.assignmentId,
      studentMemberId: schoolSubmissions.studentMemberId,
      status: schoolSubmissions.status,
    })
    .from(schoolSubmissions)
    .where(inArray(schoolSubmissions.assignmentId, assignmentIds));
  const gradeRows =
    submissionRows.length > 0
      ? await db
          .select({ submissionId: schoolGrades.submissionId, score: schoolGrades.score })
          .from(schoolGrades)
          .where(
            inArray(
              schoolGrades.submissionId,
              submissionRows.map((s) => s.id),
            ),
          )
      : [];
  const scoreBySubmission = new Map(gradeRows.map((g) => [g.submissionId, g.score]));
  const workByAssignment = new Map<string, Map<string, StudentWorkState>>();
  for (const s of submissionRows) {
    const byStudent = workByAssignment.get(s.assignmentId) ?? new Map<string, StudentWorkState>();
    byStudent.set(
      s.studentMemberId,
      mergeStudentWork(byStudent.get(s.studentMemberId), {
        submissionStatus: s.status,
        score: scoreBySubmission.get(s.id) ?? null,
      }),
    );
    workByAssignment.set(s.assignmentId, byStudent);
  }

  const memberRows = await db
    .select({ id: householdMembers.id, name: householdMembers.name })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));
  const labelById = new Map(memberRows.map((m) => [m.id, memberShownLabel(m)]));

  for (const filter of ["due", "overdue"] as const) {
    for (const row of rows) {
      const { include, owedBy } = openWorkForAssignment({
        assignment: {
          id: row.id,
          visibility: row.visibility,
          dueAt: row.dueAt!,
          pointsPossible: row.pointsPossible,
        },
        studentIds: studentsByClass.get(row.classId) ?? [],
        workByStudent: workByAssignment.get(row.id) ?? new Map(),
        filter,
        now,
        weekAhead,
      });
      if (!include) continue;
      lists[filter].push({
        ...row,
        dueAt: row.dueAt!.toISOString(),
        overdue: filter === "overdue",
        students: owedBy.map((memberId) => ({
          memberId,
          label: labelById.get(memberId) ?? "Student",
        })),
      });
    }
    lists[filter].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }
  return lists;
}
