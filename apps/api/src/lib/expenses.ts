import type { Database } from "@domi-ops/db";
import { expenseBudgets, expenses, type expenses as expensesTable } from "@domi-ops/db";
import { and, eq, sql } from "drizzle-orm";

export const BUDGET_WARNING_RATIO = 0.8;

export interface SerializedExpense {
  id: string;
  title: string;
  amount: number;
  category: string | null;
  expenseDate: string;
  createdByDisplayName: string | null;
}

export interface BudgetSummary {
  id: string;
  category: string;
  monthlyTarget: number;
  monthSpend: number;
  percentUsed: number;
  status: "under" | "warning" | "over";
}

export function normalizeExpenseCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function serializeExpense(
  row: Pick<
    typeof expensesTable.$inferSelect,
    "id" | "title" | "amount" | "category" | "expenseDate" | "createdByDisplayName"
  >,
): SerializedExpense {
  return {
    id: row.id,
    title: row.title,
    amount: row.amount,
    category: row.category,
    expenseDate: row.expenseDate,
    createdByDisplayName: row.createdByDisplayName,
  };
}

export async function collectExpenseCategorySuggestions(
  db: Database,
  householdId: string,
  q: string,
): Promise<string[]> {
  const rows = await db
    .select({ category: expenses.category })
    .from(expenses)
    .where(and(eq(expenses.householdId, householdId), sql`${expenses.category} IS NOT NULL`));

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const needle = q.trim().toLowerCase();

  for (const row of rows) {
    const cat = row.category?.trim();
    if (!cat) continue;
    const key = cat.toLowerCase();
    if (seen.has(key)) continue;
    if (needle && !key.includes(needle)) continue;
    seen.add(key);
    suggestions.push(cat);
  }

  suggestions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return suggestions.slice(0, 25);
}

export async function sumCategorySpendForMonth(
  db: Database,
  householdId: string,
  category: string,
  monthKey: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(
      and(
        eq(expenses.householdId, householdId),
        sql`lower(trim(${expenses.category})) = ${category.trim().toLowerCase()}`,
        sql`to_char(${expenses.expenseDate}, 'YYYY-MM') = ${monthKey}`,
      ),
    );
  return Number(row?.total ?? 0);
}

export function budgetStatus(
  monthSpend: number,
  monthlyTarget: number,
): BudgetSummary["status"] {
  if (monthlyTarget <= 0) return "under";
  const ratio = monthSpend / monthlyTarget;
  if (ratio >= 1) return "over";
  if (ratio >= BUDGET_WARNING_RATIO) return "warning";
  return "under";
}

export async function buildBudgetSummaries(
  db: Database,
  householdId: string,
  monthKey = currentMonthKey(),
): Promise<BudgetSummary[]> {
  const budgets = await db
    .select()
    .from(expenseBudgets)
    .where(eq(expenseBudgets.householdId, householdId))
    .orderBy(expenseBudgets.category);

  const summaries: BudgetSummary[] = [];
  for (const budget of budgets) {
    const monthSpend = await sumCategorySpendForMonth(db, householdId, budget.category, monthKey);
    const percentUsed =
      budget.monthlyTarget > 0 ? Math.round((monthSpend / budget.monthlyTarget) * 100) : 0;
    summaries.push({
      id: budget.id,
      category: budget.category,
      monthlyTarget: budget.monthlyTarget,
      monthSpend,
      percentUsed,
      status: budgetStatus(monthSpend, budget.monthlyTarget),
    });
  }
  return summaries;
}

export const UNCATEGORIZED_LABEL = "Uncategorized";

export type ExpenseReportCategoryStatus = BudgetSummary["status"] | "unbudgeted";

export interface ExpenseReportCategoryRow {
  category: string;
  spend: number;
  monthlyTarget: number | null;
  percentUsed: number | null;
  status: ExpenseReportCategoryStatus;
}

export interface ExpenseReport {
  month: string;
  monthSpend: number;
  monthBudgeted: number;
  percentUsed: number | null;
  expenseCount: number;
  byCategory: ExpenseReportCategoryRow[];
  topCategories: { category: string; spend: number }[];
  monthlyTrend: { month: string; total: number }[];
  budgetHealth: {
    over: string[];
    nearlyFull: string[];
    under: string[];
    unbudgeted: string[];
  };
  recentBigSpends: SerializedExpense[];
}

export function normalizeMonthKey(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
  const month = Number(trimmed.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return trimmed;
}

export function monthKeysEndingAt(endMonthKey: string, count: number): string[] {
  const [yearStr, monthStr] = endMonthKey.split("-");
  let year = Number(yearStr);
  let month = Number(monthStr);
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    keys.unshift(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

type ExpenseReportRow = Pick<
  typeof expensesTable.$inferSelect,
  "id" | "title" | "amount" | "category" | "expenseDate" | "createdByDisplayName"
>;

export function buildExpenseReportFromData(
  expenseRows: ExpenseReportRow[],
  budgets: BudgetSummary[],
  monthKey: string,
  trendMonthCount = 6,
): ExpenseReport {
  const trendMonths = monthKeysEndingAt(monthKey, trendMonthCount);
  const categorySpend = new Map<string, { display: string; spend: number }>();
  const monthlyTotals = new Map<string, number>();
  let monthSpend = 0;
  let expenseCount = 0;
  const monthExpenses: ExpenseReportRow[] = [];

  for (const expense of expenseRows) {
    const expenseMonth = expense.expenseDate.slice(0, 7);
    if (trendMonths.includes(expenseMonth)) {
      monthlyTotals.set(expenseMonth, (monthlyTotals.get(expenseMonth) ?? 0) + expense.amount);
    }
    if (expenseMonth !== monthKey) continue;

    monthSpend += expense.amount;
    expenseCount += 1;
    monthExpenses.push(expense);

    const category = expense.category?.trim();
    const key = category ? category.toLowerCase() : UNCATEGORIZED_LABEL.toLowerCase();
    const display = category ?? UNCATEGORIZED_LABEL;
    const existing = categorySpend.get(key);
    if (existing) {
      existing.spend += expense.amount;
    } else {
      categorySpend.set(key, { display, spend: expense.amount });
    }
  }

  const monthBudgeted = budgets.reduce((sum, budget) => sum + budget.monthlyTarget, 0);
  const percentUsed =
    monthBudgeted > 0 ? Math.round((monthSpend / monthBudgeted) * 100) : null;

  const byCategory: ExpenseReportCategoryRow[] = [];
  const seenCategories = new Set<string>();

  for (const budget of budgets) {
    const key = budget.category.trim().toLowerCase();
    seenCategories.add(key);
    const spend = categorySpend.get(key)?.spend ?? 0;
    byCategory.push({
      category: budget.category,
      spend,
      monthlyTarget: budget.monthlyTarget,
      percentUsed:
        budget.monthlyTarget > 0 ? Math.round((spend / budget.monthlyTarget) * 100) : null,
      status: budgetStatus(spend, budget.monthlyTarget),
    });
  }

  for (const [key, { display, spend }] of categorySpend) {
    if (seenCategories.has(key)) continue;
    byCategory.push({
      category: display,
      spend,
      monthlyTarget: null,
      percentUsed: null,
      status: "unbudgeted",
    });
  }

  byCategory.sort((a, b) => b.spend - a.spend);

  const topCategories = [...categorySpend.values()]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5)
    .map(({ display, spend }) => ({ category: display, spend }));

  const monthlyTrend = trendMonths.map((month) => ({
    month,
    total: monthlyTotals.get(month) ?? 0,
  }));

  const budgetHealth = {
    over: byCategory.filter((row) => row.status === "over").map((row) => row.category),
    nearlyFull: byCategory.filter((row) => row.status === "warning").map((row) => row.category),
    under: byCategory
      .filter((row) => row.status === "under" && row.monthlyTarget !== null)
      .map((row) => row.category),
    unbudgeted: byCategory.filter((row) => row.status === "unbudgeted").map((row) => row.category),
  };

  const recentBigSpends = [...monthExpenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map(serializeExpense);

  return {
    month: monthKey,
    monthSpend,
    monthBudgeted,
    percentUsed,
    expenseCount,
    byCategory,
    topCategories,
    monthlyTrend,
    budgetHealth,
    recentBigSpends,
  };
}

export async function buildExpenseReports(
  db: Database,
  householdId: string,
  monthKey = currentMonthKey(),
): Promise<ExpenseReport> {
  const normalized = normalizeMonthKey(monthKey) ?? currentMonthKey();
  const trendMonths = monthKeysEndingAt(normalized, 6);
  const earliest = trendMonths[0]!;

  const rows = await db
    .select({
      id: expenses.id,
      title: expenses.title,
      amount: expenses.amount,
      category: expenses.category,
      expenseDate: expenses.expenseDate,
      createdByDisplayName: expenses.createdByDisplayName,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.householdId, householdId),
        sql`to_char(${expenses.expenseDate}, 'YYYY-MM') >= ${earliest}`,
        sql`to_char(${expenses.expenseDate}, 'YYYY-MM') <= ${normalized}`,
      ),
    );

  const budgets = await buildBudgetSummaries(db, householdId, normalized);
  return buildExpenseReportFromData(rows, budgets, normalized);
}
