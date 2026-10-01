import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers, schoolEnrollments, users } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import { deliverUserNotification } from "@domi-ops/calendar-sync";
import { submissionRecipientMemberIds } from "./school-grading-queue.js";

/** Tells the class's teachers a student turned work in. Gated on the school push preference. */
export async function notifyTeachersOfSubmission(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    classId: string;
    teacherMemberId: string;
    className: string;
    assignmentId: string;
    assignmentTitle: string;
    submissionId: string;
    turnInCount: number;
    studentMemberId: string;
    studentLabel: string;
    isLate: boolean;
  },
): Promise<void> {
  const enrollments = await db
    .select({
      memberId: schoolEnrollments.memberId,
      role: schoolEnrollments.role,
      activeFrom: schoolEnrollments.activeFrom,
      activeTo: schoolEnrollments.activeTo,
    })
    .from(schoolEnrollments)
    .where(eq(schoolEnrollments.classId, input.classId));

  const recipientMemberIds = submissionRecipientMemberIds({
    teacherMemberId: input.teacherMemberId,
    enrollments,
    submitterMemberId: input.studentMemberId,
  });
  if (recipientMemberIds.length === 0) return;

  const members = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, input.householdId),
        inArray(householdMembers.id, recipientMemberIds),
      ),
    );
  const recipientUserIds = [...new Set(members.map((m) => m.userId))];
  if (recipientUserIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, recipientUserIds), eq(users.pushSchoolRemindersEnabled, true)));
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title: input.isLate ? "Late submission" : "New submission",
    body: `${input.studentLabel} turned in "${input.assignmentTitle}" (${input.className})`,
    url: `/school/assignment/${input.assignmentId}`,
    // One notification per turn-in, so a resubmit pings again but a retry of the same one doesn't.
    tag: `school-submission-${input.submissionId}-${input.turnInCount}`,
  });
}
