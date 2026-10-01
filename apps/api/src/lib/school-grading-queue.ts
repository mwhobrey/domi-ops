import { memberShownLabel } from "@domi-ops/auth";
import type { Database } from "@domi-ops/db";
import {
  householdMembers,
  schoolAssignments,
  schoolClasses,
  schoolSubmissions,
} from "@domi-ops/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  isEnrollmentActiveNow,
  isStaffEnrollmentRole,
  resolveClassAccess,
  type MemberEnrollmentRow,
} from "./school-access.js";

/** Non-archived classes where the member can grade (household admin, class teacher, or staff enrollment). */
export function gradableClassIds(params: {
  memberId: string;
  householdRole: string;
  classes: { id: string; teacherMemberId: string; archived: boolean }[];
  enrollments: MemberEnrollmentRow[];
}): string[] {
  const { memberId, householdRole, classes, enrollments } = params;
  return classes
    .filter((cls) => !cls.archived)
    .filter(
      (cls) =>
        resolveClassAccess({
          memberId,
          householdRole,
          teacherMemberId: cls.teacherMemberId,
          enrollment: enrollments.find((e) => e.classId === cls.id) ?? null,
        }).canGrade,
    )
    .map((cls) => cls.id);
}

/**
 * Who hears about a new submission: the class teacher plus actively enrolled teachers, parents
 * and aides. The submitter is never their own recipient.
 */
export function submissionRecipientMemberIds(params: {
  teacherMemberId: string;
  enrollments: {
    memberId: string;
    role: string;
    activeFrom: string | Date | null;
    activeTo: string | Date | null;
  }[];
  submitterMemberId: string;
}): string[] {
  const ids = new Set<string>([params.teacherMemberId]);
  for (const e of params.enrollments) {
    if (isStaffEnrollmentRole(e.role) && isEnrollmentActiveNow(e.activeFrom, e.activeTo)) {
      ids.add(e.memberId);
    }
  }
  ids.delete(params.submitterMemberId);
  return [...ids];
}

export type GradingQueueItem = {
  submissionId: string;
  assignmentId: string;
  assignmentTitle: string;
  dueAt: string | null;
  pointsPossible: number;
  classId: string;
  className: string;
  classSubject: string | null;
  classTerm: string | null;
  studentMemberId: string;
  studentLabel: string;
  submittedAt: string | null;
  isLate: boolean;
  turnInCount: number;
};

/**
 * Turned-in work still waiting on a grade across `classIds`, oldest first. Auto-graded tests that
 * need no teacher input are already "graded" and never appear. Closed assignments stay on the
 * list: closing stops new turn-ins, it doesn't grade what's already in.
 */
export async function loadGradingQueue(
  db: Database,
  params: { householdId: string; classIds: string[] },
): Promise<GradingQueueItem[]> {
  if (params.classIds.length === 0) return [];

  const rows = await db
    .select({
      submissionId: schoolSubmissions.id,
      assignmentId: schoolAssignments.id,
      assignmentTitle: schoolAssignments.title,
      dueAt: schoolAssignments.dueAt,
      pointsPossible: schoolAssignments.pointsPossible,
      classId: schoolClasses.id,
      className: schoolClasses.name,
      classSubject: schoolClasses.subject,
      classTerm: schoolClasses.term,
      studentMemberId: schoolSubmissions.studentMemberId,
      submittedAt: schoolSubmissions.submittedAt,
      isLate: schoolSubmissions.isLate,
      turnInCount: schoolSubmissions.turnInCount,
    })
    .from(schoolSubmissions)
    .innerJoin(schoolAssignments, eq(schoolSubmissions.assignmentId, schoolAssignments.id))
    .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
    .where(
      and(
        eq(schoolClasses.householdId, params.householdId),
        inArray(schoolClasses.id, params.classIds),
        eq(schoolSubmissions.status, "submitted"),
      ),
    )
    .orderBy(sql`${schoolSubmissions.submittedAt} asc nulls last`, asc(schoolSubmissions.id));
  if (rows.length === 0) return [];

  const memberRows = await db
    .select({ id: householdMembers.id, name: householdMembers.name })
    .from(householdMembers)
    .where(
      inArray(householdMembers.id, [...new Set(rows.map((r) => r.studentMemberId))]),
    );
  const labelById = new Map(memberRows.map((m) => [m.id, memberShownLabel(m)]));

  return rows.map((r) => ({
    ...r,
    dueAt: r.dueAt?.toISOString() ?? null,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    studentLabel: labelById.get(r.studentMemberId) ?? "Student",
  }));
}

export async function countGradingQueue(
  db: Database,
  params: { householdId: string; classIds: string[] },
): Promise<number> {
  if (params.classIds.length === 0) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schoolSubmissions)
    .innerJoin(schoolAssignments, eq(schoolSubmissions.assignmentId, schoolAssignments.id))
    .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
    .where(
      and(
        eq(schoolClasses.householdId, params.householdId),
        inArray(schoolClasses.id, params.classIds),
        eq(schoolSubmissions.status, "submitted"),
      ),
    );
  return row?.count ?? 0;
}
