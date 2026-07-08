import type { Database } from "@domi-ops/db";
import { householdMembers, schoolClasses, schoolEnrollments } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import { resolveSchoolContext, type MemberEnrollmentRow } from "./school-access.js";

export async function memberEnrollmentsForHousehold(
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

export async function schoolContextForAuth(
  db: Database,
  auth: { householdId: string; userId: string },
) {
  const [hm] = await db
    .select({ id: householdMembers.id, role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, auth.householdId), eq(householdMembers.userId, auth.userId)))
    .limit(1);
  if (!hm) return null;
  const enrollments = await memberEnrollmentsForHousehold(db, auth.householdId, hm.id);
  const taught = await db
    .select({ id: schoolClasses.id })
    .from(schoolClasses)
    .where(
      and(eq(schoolClasses.householdId, auth.householdId), eq(schoolClasses.teacherMemberId, hm.id)),
    );
  return resolveSchoolContext({
    memberId: hm.id,
    householdRole: hm.role,
    enrollments,
    taughtClassIds: taught.map((t) => t.id),
  });
}
