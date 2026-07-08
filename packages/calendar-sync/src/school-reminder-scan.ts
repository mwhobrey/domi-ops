import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  householdMembers,
  households,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolSubmissions,
  users,
} from "@domi-ops/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  classifyDueReminder,
  todayIsoDateInTz,
  type DueReminderKind,
} from "./household-time.js";
import { deliverUserNotification } from "./user-notify.js";

function householdHasSchoolModule(modulesEnabled: string): boolean {
  try {
    const modules = JSON.parse(modulesEnabled) as string[];
    return modules.includes("school");
  } catch {
    return true;
  }
}

function isEnrollmentActiveNow(
  activeFrom: string | Date | null,
  activeTo: string | Date | null,
): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (activeFrom) {
    const from = new Date(
      typeof activeFrom === "string" && !activeFrom.includes("T")
        ? `${activeFrom}T12:00:00`
        : activeFrom,
    );
    if (from > today) return false;
  }
  if (activeTo) {
    const to = new Date(
      typeof activeTo === "string" && !activeTo.includes("T")
        ? `${activeTo}T12:00:00`
        : activeTo,
    );
    if (to < today) return false;
  }
  return true;
}

function submissionBlocksReminder(status: string | null | undefined): boolean {
  return status === "submitted" || status === "graded" || status === "returned";
}

function schoolReminderCopy(
  title: string,
  className: string,
  kind: DueReminderKind,
): { title: string; body: string } {
  switch (kind) {
    case "due_tomorrow":
      return {
        title: "Assignment due tomorrow",
        body: `"${title}" (${className}) is due tomorrow`,
      };
    case "due_today":
      return {
        title: "Assignment due today",
        body: `"${title}" (${className}) is due today`,
      };
    case "overdue":
      return {
        title: "Assignment overdue",
        body: `"${title}" (${className}) is overdue`,
      };
  }
}

async function notifySchoolAssignmentReminder(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    assignmentId: string;
    title: string;
    className: string;
    recipientUserIds: string[];
    kind: DueReminderKind;
  },
): Promise<void> {
  if (input.recipientUserIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, input.recipientUserIds),
        eq(users.pushSchoolRemindersEnabled, true),
      ),
    );
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  const copy = schoolReminderCopy(input.title, input.className, input.kind);
  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title: copy.title,
    body: copy.body,
    url: `/school/assignment/${input.assignmentId}`,
    tag: `school-assignment-${input.assignmentId}-${input.kind}`,
  });
}

export async function scanSchoolReminders(db: Database, env: Env): Promise<number> {
  const schoolHouseholds = await db
    .select({
      id: households.id,
      modulesEnabled: households.modulesEnabled,
      timezone: households.timezone,
    })
    .from(households);

  const enabledHouseholds = schoolHouseholds.filter((h) =>
    householdHasSchoolModule(h.modulesEnabled),
  );
  const enabledHouseholdIds = enabledHouseholds.map((h) => h.id);
  if (enabledHouseholdIds.length === 0) return 0;

  const tzByHousehold = new Map(enabledHouseholds.map((h) => [h.id, h.timezone]));
  const now = new Date();
  let sent = 0;

  const assignmentRows = await db
    .select({
      id: schoolAssignments.id,
      title: schoolAssignments.title,
      dueAt: schoolAssignments.dueAt,
      dueReminderSentAt: schoolAssignments.dueReminderSentAt,
      classId: schoolAssignments.classId,
      className: schoolClasses.name,
      householdId: schoolClasses.householdId,
    })
    .from(schoolAssignments)
    .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
    .where(
      and(
        inArray(schoolClasses.householdId, enabledHouseholdIds),
        eq(schoolClasses.archived, false),
        eq(schoolAssignments.visibility, "assigned"),
        isNotNull(schoolAssignments.dueAt),
      ),
    );

  for (const row of assignmentRows) {
    if (!row.dueAt) continue;

    const tz = tzByHousehold.get(row.householdId) ?? "UTC";
    const today = todayIsoDateInTz(tz);
    const dueDateStr = row.dueAt.toLocaleDateString("en-CA", { timeZone: tz });
    const kind = classifyDueReminder({
      dueDate: dueDateStr,
      today,
      lastSentAt: row.dueReminderSentAt,
      now,
      timeZone: tz,
    });
    if (!kind) continue;

    const enrollments = await db
      .select({
        memberId: schoolEnrollments.memberId,
        role: schoolEnrollments.role,
        activeFrom: schoolEnrollments.activeFrom,
        activeTo: schoolEnrollments.activeTo,
      })
      .from(schoolEnrollments)
      .where(eq(schoolEnrollments.classId, row.classId));

    const studentMemberIds = enrollments
      .filter(
        (e) =>
          e.role === "student" &&
          isEnrollmentActiveNow(e.activeFrom, e.activeTo),
      )
      .map((e) => e.memberId);
    if (studentMemberIds.length === 0) continue;

    const submissions = await db
      .select({
        studentMemberId: schoolSubmissions.studentMemberId,
        status: schoolSubmissions.status,
      })
      .from(schoolSubmissions)
      .where(eq(schoolSubmissions.assignmentId, row.id));

    const submissionByMember = new Map(
      submissions.map((s) => [s.studentMemberId, s.status]),
    );

    const pendingMemberIds = studentMemberIds.filter(
      (memberId) => !submissionBlocksReminder(submissionByMember.get(memberId)),
    );
    if (pendingMemberIds.length === 0) {
      await db
        .update(schoolAssignments)
        .set({ dueReminderSentAt: now })
        .where(eq(schoolAssignments.id, row.id));
      continue;
    }

    const members = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, row.householdId),
          inArray(householdMembers.id, pendingMemberIds),
        ),
      );

    const recipientUserIds = [...new Set(members.map((m) => m.userId))];
    if (recipientUserIds.length === 0) continue;

    await notifySchoolAssignmentReminder(db, env, {
      householdId: row.householdId,
      assignmentId: row.id,
      title: row.title,
      className: row.className,
      recipientUserIds,
      kind,
    });

    await db
      .update(schoolAssignments)
      .set({ dueReminderSentAt: now })
      .where(eq(schoolAssignments.id, row.id));
    sent += 1;
  }

  return sent;
}
