import type { Database } from "@domi-ops/db";
import {
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolSubmissions,
} from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import {
  resolveClassAccess,
  type SchoolClassAccess,
} from "./school-access.js";

export interface SubmissionAccessContext {
  submission: typeof schoolSubmissions.$inferSelect;
  assignment: typeof schoolAssignments.$inferSelect;
  cls: typeof schoolClasses.$inferSelect;
  access: SchoolClassAccess;
  memberId: string;
}

export async function submissionAccessForAuth(
  db: Database,
  auth: { householdId: string; userId: string },
  submissionId: string,
  memberContext: { memberId: string; householdRole: string },
): Promise<SubmissionAccessContext | null> {
  const [submission] = await db
    .select()
    .from(schoolSubmissions)
    .where(eq(schoolSubmissions.id, submissionId))
    .limit(1);
  if (!submission) return null;

  const [assignment] = await db
    .select()
    .from(schoolAssignments)
    .where(eq(schoolAssignments.id, submission.assignmentId))
    .limit(1);
  if (!assignment) return null;

  const [cls] = await db
    .select()
    .from(schoolClasses)
    .where(
      and(eq(schoolClasses.id, assignment.classId), eq(schoolClasses.householdId, auth.householdId)),
    )
    .limit(1);
  if (!cls) return null;

  const [myEnrollment] = await db
    .select()
    .from(schoolEnrollments)
    .where(
      and(
        eq(schoolEnrollments.classId, cls.id),
        eq(schoolEnrollments.memberId, memberContext.memberId),
      ),
    )
    .limit(1);

  const access = resolveClassAccess({
    memberId: memberContext.memberId,
    householdRole: memberContext.householdRole,
    teacherMemberId: cls.teacherMemberId,
    enrollment: myEnrollment ?? null,
  });

  return { submission, assignment, cls, access, memberId: memberContext.memberId };
}

export function canModifySubmissionArtifacts(
  ctx: SubmissionAccessContext,
): boolean {
  if (ctx.access.canGrade || ctx.access.canViewFullGradebook) return true;
  return (
    ctx.access.canSubmit && ctx.submission.studentMemberId === ctx.memberId
  );
}

export function canViewSubmissionArtifacts(ctx: SubmissionAccessContext): boolean {
  if (ctx.access.canGrade || ctx.access.canViewFullGradebook) return true;
  return (
    ctx.access.canSubmit && ctx.submission.studentMemberId === ctx.memberId
  );
}
