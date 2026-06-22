import type { Database } from "@whome/db";
import { expenses } from "@whome/db";
import { and, eq, gte, lte } from "drizzle-orm";
import {
  countReportItems,
  dueDateLabel,
  groupItemsByDay,
  resolveMonFriWeek,
  sortGroups,
} from "./helpers.js";
import type { WeeklyReportData, WeeklyReportGroup, WeeklyReportItem } from "./types.js";
import { weeklyReportTitle, weeklyVariantLabel } from "./types.js";

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

type ExpensesVariant = "by-category" | "by-day";

export async function buildExpensesWeeklyReport(params: {
  db: Database;
  householdId: string;
  variant: ExpensesVariant;
  weekStart?: string | null;
  scope?: "week" | "range";
}): Promise<WeeklyReportData> {
  const week = await resolveMonFriWeek(params.db, params.householdId, params.weekStart);
  const scope = params.scope ?? "week";
  const variantLabel = weeklyVariantLabel(params.variant, scope, "expenses");

  const rows = await params.db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.householdId, params.householdId),
        gte(expenses.expenseDate, week.weekStart),
        lte(expenses.expenseDate, week.weekEnd),
      ),
    );

  let groups: WeeklyReportGroup[];
  if (params.variant === "by-day") {
    const items: WeeklyReportItem[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.category?.trim() || "Uncategorized",
      dueDate: row.expenseDate,
      dueLabel: formatMoney(row.amount),
    }));
    groups = groupItemsByDay(items, week.weekStart, week.weekEnd);
  } else {
    const groupMap = new Map<string, WeeklyReportGroup>();
    for (const row of rows) {
      const dueDate = row.expenseDate;
      const category = row.category?.trim() || "Uncategorized";
      const item: WeeklyReportItem = {
        id: row.id,
        title: row.title,
        subtitle: formatMoney(row.amount),
        dueDate,
        dueLabel: dueDateLabel(dueDate),
      };
      const groupKey = category.toLowerCase();
      let group = groupMap.get(groupKey);
      if (!group) {
        group = { key: groupKey, label: category, items: [] };
        groupMap.set(groupKey, group);
      }
      group.items.push(item);
    }
    groups = sortGroups([...groupMap.values()]);
  }

  return {
    module: "expenses",
    variant: params.variant,
    variantLabel,
    title: weeklyReportTitle("expenses", variantLabel, week.weekLabel),
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    weekLabel: week.weekLabel,
    timezone: week.timezone,
    groups,
    totalItems: countReportItems(groups),
  };
}
