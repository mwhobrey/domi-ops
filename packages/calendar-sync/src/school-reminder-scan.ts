import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  householdMembers,
  households,
  pushSubscriptions,
  schoolAssignments,
  schoolClasses,
  schoolEnrollments,
  schoolSubmissions,
  users,
} from "@whome/db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import webpush from "web-push";
import { deliverWebPush } from "./push-delivery.js";

// TODO: use household timezone from DB for due-date boundaries (currently UTC date).
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

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

function configured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

async function notifySchoolAssignmentReminder(
  db: Database,
  env: Env,
  input: {
    assignmentId: string;
    title: string;
    className: string;
    recipientUserIds: string[];
    kind: "due_today" | "overdue";
  },
): Promise<void> {
  if (!configured(env) || input.recipientUserIds.length === 0) return;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );

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

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, enabledIds));
  if (subs.length === 0) return;

  const body =
    input.kind === "overdue"
      ? `"${input.title}" (${input.className}) is overdue`
      : `"${input.title}" (${input.className}) is due today`;

  await deliverWebPush(db, subs, {
    title: input.kind === "overdue" ? "Assignment overdue" : "Assignment due today",
    body,
    tag: `school-assignment-${input.assignmentId}`,
    data: { url: `/school/assignment/${input.assignmentId}` },
  });
}

export async function scanSchoolReminders(db: Database, env: Env): Promise<number> {
  if (!configured(env)) return 0;

  const schoolHouseholds = await db
    .select({ id: households.id, modulesEnabled: households.modulesEnabled })
    .from(households);

  const enabledHouseholdIds = schoolHouseholds
    .filter((h) => householdHasSchoolModule(h.modulesEnabled))
    .map((h) => h.id);
  if (enabledHouseholdIds.length === 0) return 0;

  const today = todayIsoDate();
  const now = new Date();
  let sent = 0;

  const assignmentRows = await db
    .select({
      id: schoolAssignments.id,
      title: schoolAssignments.title,
      dueAt: schoolAssignments.dueAt,
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
        isNull(schoolAssignments.dueReminderSentAt),
      ),
    );

  for (const row of assignmentRows) {
    if (!row.dueAt) continue;

    const dueDateStr = row.dueAt.toISOString().slice(0, 10);
    let kind: "due_today" | "overdue" | null = null;
    if (dueDateStr < today) kind = "overdue";
    else if (dueDateStr === today) kind = "due_today";
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
