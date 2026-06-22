import type { Database } from "@whome/db";
import {
  chores,
  choresRecurring,
  householdMembers,
  shoppingRecurring,
  users,
} from "@whome/db";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { parseChoreTagsJson } from "../chores.js";
import { parseShoppingTagsJson } from "../shopping.js";
import {
  countReportItems,
  dueDateLabel,
  groupItemsByDay,
  resolveMonFriWeek,
  sortGroups,
} from "./helpers.js";
import type { WeeklyReportData, WeeklyReportGroup, WeeklyReportItem } from "./types.js";
import { weeklyReportTitle, weeklyVariantLabel } from "./types.js";

type ChoresVariant = "by-list" | "by-assignee" | "by-day";
type ShoppingVariant = "by-aisle" | "by-item" | "by-day";

async function memberLabels(db: Database, householdId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({
      id: householdMembers.id,
      name: householdMembers.name,
      legacyDisplayName: householdMembers.legacyDisplayName,
      email: users.email,
      username: users.username,
    })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, householdId));
  return new Map(
    rows.map((m) => [
      m.id,
      m.name?.trim() || m.legacyDisplayName?.trim() || m.username || m.email || "Member",
    ]),
  );
}

export async function buildChoresWeeklyReport(params: {
  db: Database;
  householdId: string;
  variant: ChoresVariant;
  weekStart?: string | null;
  scope?: "week" | "range";
}): Promise<WeeklyReportData> {
  const week = await resolveMonFriWeek(params.db, params.householdId, params.weekStart);
  const scope = params.scope ?? "week";
  const variantLabel = weeklyVariantLabel(params.variant, scope, "chores");
  const labels = await memberLabels(params.db, params.householdId);

  const openChores = await params.db
    .select()
    .from(chores)
    .where(
      and(
        eq(chores.householdId, params.householdId),
        eq(chores.done, false),
        isNotNull(chores.dueDate),
        gte(chores.dueDate, week.weekStart),
        lte(chores.dueDate, week.weekEnd),
      ),
    );

  const recurringDue = await params.db
    .select()
    .from(choresRecurring)
    .where(
      and(
        eq(choresRecurring.householdId, params.householdId),
        eq(choresRecurring.enabled, true),
        gte(choresRecurring.nextAt, week.weekStart),
        lte(choresRecurring.nextAt, week.weekEnd),
      ),
    );

  const items: WeeklyReportItem[] = [];

  for (const row of openChores) {
    const dueDate = row.dueDate!;
    const { list } = parseChoreTagsJson(row.tagsJson);
    const listLabel = list?.trim() || "General";
    const assigneeLabel = row.assigneeMemberId
      ? (labels.get(row.assigneeMemberId) ?? "Unassigned")
      : "Unassigned";
    items.push({
      id: row.id,
      title: row.description,
      subtitle:
        params.variant === "by-day"
          ? [listLabel !== "General" ? listLabel : null, assigneeLabel !== "Unassigned" ? assigneeLabel : null]
              .filter(Boolean)
              .join(" · ") || null
          : params.variant === "by-list"
            ? assigneeLabel
            : listLabel,
      dueDate,
      dueLabel: dueDateLabel(dueDate),
    });
  }

  for (const row of recurringDue) {
    const dueDate = row.nextAt;
    const { list } = parseChoreTagsJson(row.tagsJson);
    const listLabel = list?.trim() || "General";
    const assigneeLabel = row.assigneeMemberId
      ? (labels.get(row.assigneeMemberId) ?? "Unassigned")
      : "Unassigned";
    items.push({
      id: `recurring:${row.id}`,
      title: row.description,
      subtitle:
        params.variant === "by-day"
          ? `${[listLabel !== "General" ? listLabel : null, assigneeLabel !== "Unassigned" ? assigneeLabel : null].filter(Boolean).join(" · ") || "General"} · recurring`
          : params.variant === "by-list"
            ? `${assigneeLabel} · recurring`
            : `${listLabel} · recurring`,
      dueDate,
      dueLabel: dueDateLabel(dueDate),
    });
  }

  let groups: WeeklyReportGroup[];
  if (params.variant === "by-day") {
    groups = groupItemsByDay(items, week.weekStart, week.weekEnd);
  } else {
    const groupMap = new Map<string, WeeklyReportGroup>();
    for (const row of openChores) {
      const dueDate = row.dueDate!;
      const { list } = parseChoreTagsJson(row.tagsJson);
      const listLabel = list?.trim() || "General";
      const assigneeLabel = row.assigneeMemberId
        ? (labels.get(row.assigneeMemberId) ?? "Unassigned")
        : "Unassigned";
      const key =
        params.variant === "by-list"
          ? listLabel.toLowerCase()
          : (row.assigneeMemberId ?? "unassigned");
      const label = params.variant === "by-list" ? listLabel : assigneeLabel;
      const item: WeeklyReportItem = {
        id: row.id,
        title: row.description,
        subtitle: params.variant === "by-list" ? assigneeLabel : listLabel,
        dueDate,
        dueLabel: dueDateLabel(dueDate),
      };
      let group = groupMap.get(key);
      if (!group) {
        group = { key, label, items: [] };
        groupMap.set(key, group);
      }
      group.items.push(item);
    }
    for (const row of recurringDue) {
      const dueDate = row.nextAt;
      const { list } = parseChoreTagsJson(row.tagsJson);
      const listLabel = list?.trim() || "General";
      const assigneeLabel = row.assigneeMemberId
        ? (labels.get(row.assigneeMemberId) ?? "Unassigned")
        : "Unassigned";
      const key =
        params.variant === "by-list"
          ? listLabel.toLowerCase()
          : (row.assigneeMemberId ?? "unassigned");
      const label = params.variant === "by-list" ? listLabel : assigneeLabel;
      const item: WeeklyReportItem = {
        id: `recurring:${row.id}`,
        title: row.description,
        subtitle:
          params.variant === "by-list"
            ? `${assigneeLabel} · recurring`
            : `${listLabel} · recurring`,
        dueDate,
        dueLabel: dueDateLabel(dueDate),
      };
      let group = groupMap.get(key);
      if (!group) {
        group = { key, label, items: [] };
        groupMap.set(key, group);
      }
      group.items.push(item);
    }
    groups = sortGroups([...groupMap.values()]);
  }

  return {
    module: "chores",
    variant: params.variant,
    variantLabel,
    title: weeklyReportTitle("chores", variantLabel, week.weekLabel),
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    weekLabel: week.weekLabel,
    timezone: week.timezone,
    groups,
    totalItems: countReportItems(groups),
  };
}

export async function buildShoppingWeeklyReport(params: {
  db: Database;
  householdId: string;
  variant: ShoppingVariant;
  weekStart?: string | null;
  scope?: "week" | "range";
}): Promise<WeeklyReportData> {
  const week = await resolveMonFriWeek(params.db, params.householdId, params.weekStart);
  const scope = params.scope ?? "week";
  const variantLabel = weeklyVariantLabel(params.variant, scope, "shopping");

  const recurringDue = await params.db
    .select()
    .from(shoppingRecurring)
    .where(
      and(
        eq(shoppingRecurring.householdId, params.householdId),
        eq(shoppingRecurring.enabled, true),
        gte(shoppingRecurring.nextAt, week.weekStart),
        lte(shoppingRecurring.nextAt, week.weekEnd),
      ),
    );

  const items: WeeklyReportItem[] = recurringDue.map((row) => {
    const { aisle } = parseShoppingTagsJson(row.tagsJson);
    const aisleLabel = aisle?.trim() || "General";
    return {
      id: `recurring:${row.id}`,
      title: row.item,
      subtitle: params.variant === "by-day" ? aisleLabel : params.variant === "by-aisle" ? "Recurring" : aisleLabel,
      dueDate: row.nextAt,
      dueLabel: dueDateLabel(row.nextAt),
    };
  });

  let groups: WeeklyReportGroup[];
  if (params.variant === "by-day") {
    groups = groupItemsByDay(items, week.weekStart, week.weekEnd);
  } else {
    const groupMap = new Map<string, WeeklyReportGroup>();
    for (const row of recurringDue) {
      const dueDate = row.nextAt;
      const { aisle } = parseShoppingTagsJson(row.tagsJson);
      const aisleLabel = aisle?.trim() || "General";
      const groupKey =
        params.variant === "by-aisle" ? aisleLabel.toLowerCase() : row.item.trim().toLowerCase();
      const groupLabel = params.variant === "by-aisle" ? aisleLabel : row.item;
      const item: WeeklyReportItem = {
        id: `recurring:${row.id}`,
        title: row.item,
        subtitle: "Recurring",
        dueDate,
        dueLabel: dueDateLabel(dueDate),
      };
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
    module: "shopping",
    variant: params.variant,
    variantLabel,
    title: weeklyReportTitle("shopping", variantLabel, week.weekLabel),
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    weekLabel: week.weekLabel,
    timezone: week.timezone,
    groups,
    totalItems: countReportItems(groups),
  };
}
