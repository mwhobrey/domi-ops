import type { AuthContext } from "@whome/auth";
import type { Database } from "@whome/db";
import { notes, notices, schoolAssignments, schoolClasses, schoolSubmissions } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { isHouseholdAdmin } from "./school-access.js";

/** Caller must be able to edit the target entity (attach/detach Drive references). */
export async function canWriteDriveReferenceEntity(
  db: Database,
  auth: AuthContext,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  switch (entityType) {
    case "note": {
      const [row] = await db
        .select({ id: notes.id, createdByUserId: notes.createdByUserId, visibility: notes.visibility })
        .from(notes)
        .where(
          and(
            eq(notes.id, entityId),
            eq(notes.householdId, auth.householdId),
          ),
        )
        .limit(1);
      if (!row) return false;
      if (row.visibility === "household" || row.createdByUserId === auth.userId) return true;
      return false;
    }
    case "notice": {
      const [row] = await db
        .select({ id: notices.id, postedByUserId: notices.postedByUserId })
        .from(notices)
        .where(and(eq(notices.id, entityId), eq(notices.householdId, auth.householdId)))
        .limit(1);
      if (!row) return false;
      return row.postedByUserId === auth.userId;
    }
    case "school_submission": {
      const [row] = await db
        .select({
          id: schoolSubmissions.id,
          studentMemberId: schoolSubmissions.studentMemberId,
          householdId: schoolClasses.householdId,
          teacherMemberId: schoolClasses.teacherMemberId,
        })
        .from(schoolSubmissions)
        .innerJoin(schoolAssignments, eq(schoolSubmissions.assignmentId, schoolAssignments.id))
        .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
        .where(
          and(eq(schoolSubmissions.id, entityId), eq(schoolClasses.householdId, auth.householdId)),
        )
        .limit(1);
      if (!row) return false;
      if (row.studentMemberId === auth.memberId) return true;
      if (isHouseholdAdmin(auth.role)) return true;
      if (row.teacherMemberId === auth.memberId) return true;
      return false;
    }
    default:
      return false;
  }
}
