import type { Database } from "@whome/db";
import { schoolAssignments, schoolClasses } from "@whome/db";
import { localDateOfInstant } from "@whome/calendar-sync";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  memberEnrollmentsForHousehold,
  schoolContextForAuth,
} from "../school-auth-context.js";
import { visibleClassIdsForMember } from "../school-access.js";
import {
  countReportItems,
  dueDateLabel,
  groupItemsByDay,
  resolveMonFriWeek,
  sortGroups,
} from "./helpers.js";
import type { WeeklyReportData, WeeklyReportGroup, WeeklyReportItem } from "./types.js";
import { weeklyReportTitle, weeklyVariantLabel } from "./types.js";

type SchoolVariant = "by-subject" | "by-class" | "by-day";

export async function buildSchoolWeeklyReport(params: {
  db: Database;
  householdId: string;
  userId: string;
  variant: SchoolVariant;
  weekStart?: string | null;
  scope?: "week" | "range";
}): Promise<WeeklyReportData | null> {
  const context = await schoolContextForAuth(params.db, {
    householdId: params.householdId,
    userId: params.userId,
  });
  if (!context) return null;

  const week = await resolveMonFriWeek(params.db, params.householdId, params.weekStart);
  const scope = params.scope ?? "week";
  const variantLabel = weeklyVariantLabel(params.variant, scope, "school");

  const emptyReport = (): WeeklyReportData => ({
    module: "school",
    variant: params.variant,
    variantLabel,
    title: weeklyReportTitle("school", variantLabel, week.weekLabel),
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    weekLabel: week.weekLabel,
    timezone: week.timezone,
    groups: [],
    totalItems: 0,
  });

  const classRows = await params.db
    .select({
      id: schoolClasses.id,
      name: schoolClasses.name,
      subject: schoolClasses.subject,
      teacherMemberId: schoolClasses.teacherMemberId,
      archived: schoolClasses.archived,
    })
    .from(schoolClasses)
    .where(and(eq(schoolClasses.householdId, params.householdId), eq(schoolClasses.archived, false)));

  const enrollments = await memberEnrollmentsForHousehold(
    params.db,
    params.householdId,
    context.memberId,
  );
  const visibleIds = visibleClassIdsForMember({
    memberId: context.memberId,
    householdRole: context.householdRole,
    classes: classRows.map((c) => ({
      id: c.id,
      teacherMemberId: c.teacherMemberId,
      archived: c.archived ?? false,
    })),
    enrollments,
  });

  if (visibleIds.length === 0) return emptyReport();

  const rows = await params.db
    .select({
      assignmentId: schoolAssignments.id,
      title: schoolAssignments.title,
      dueAt: schoolAssignments.dueAt,
      classId: schoolClasses.id,
      className: schoolClasses.name,
      subject: schoolClasses.subject,
    })
    .from(schoolAssignments)
    .innerJoin(schoolClasses, eq(schoolAssignments.classId, schoolClasses.id))
    .where(
      and(
        inArray(schoolClasses.id, visibleIds),
        eq(schoolAssignments.visibility, "assigned"),
        isNotNull(schoolAssignments.dueAt),
      ),
    );

  const items: WeeklyReportItem[] = [];
  for (const row of rows) {
    if (!row.dueAt) continue;
    const localDue = localDateOfInstant(row.dueAt, week.timezone);
    if (localDue < week.weekStart || localDue > week.weekEnd) continue;
    const subtitle =
      params.variant === "by-day"
        ? row.subject?.trim() || row.className
        : params.variant === "by-subject"
          ? row.className
          : row.subject;
    items.push({
      id: row.assignmentId,
      title: row.title,
      subtitle,
      dueDate: localDue,
      dueLabel: dueDateLabel(localDue),
    });
  }

  let groups: WeeklyReportGroup[];
  if (params.variant === "by-day") {
    groups = groupItemsByDay(items, week.weekStart, week.weekEnd);
  } else {
    const groupMap = new Map<string, WeeklyReportGroup>();
    for (const item of items) {
      const row = rows.find((r) => r.assignmentId === item.id);
      if (!row) continue;
      const groupKey =
        params.variant === "by-subject"
          ? (row.subject?.trim() || row.className)
          : row.classId;
      const groupLabel =
        params.variant === "by-subject"
          ? (row.subject?.trim() || row.className)
          : row.className;
      let group = groupMap.get(groupKey);
      if (!group) {
        group = { key: groupKey, label: groupLabel, items: [] };
        groupMap.set(groupKey, group);
      }
      group.items.push(item);
    }
    groups = sortGroups([...groupMap.values()]);
  }

  return {
    module: "school",
    variant: params.variant,
    variantLabel,
    title: weeklyReportTitle("school", variantLabel, week.weekLabel),
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    weekLabel: week.weekLabel,
    timezone: week.timezone,
    groups,
    totalItems: countReportItems(groups),
  };
}
