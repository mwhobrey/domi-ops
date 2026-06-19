import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  expenseBudgetAlertSent,
  expenseBudgets,
  expenses,
  householdMembers,
  users,
} from "@whome/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { deliverUserNotification } from "./user-notify.js";

export const BUDGET_WARNING_RATIO = 0.8;

export type BudgetAlertKind = "warning" | "over";

function todayMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function sumCategorySpend(
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

async function alertAlreadySent(
  db: Database,
  householdId: string,
  category: string,
  monthKey: string,
  kind: BudgetAlertKind,
): Promise<boolean> {
  const [row] = await db
    .select({ id: expenseBudgetAlertSent.id })
    .from(expenseBudgetAlertSent)
    .where(
      and(
        eq(expenseBudgetAlertSent.householdId, householdId),
        eq(expenseBudgetAlertSent.category, category),
        eq(expenseBudgetAlertSent.monthKey, monthKey),
        eq(expenseBudgetAlertSent.alertKind, kind),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function markAlertSent(
  db: Database,
  householdId: string,
  category: string,
  monthKey: string,
  kind: BudgetAlertKind,
): Promise<void> {
  await db
    .insert(expenseBudgetAlertSent)
    .values({ householdId, category, monthKey, alertKind: kind })
    .onConflictDoNothing();
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

async function notifyBudgetAlert(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    category: string;
    monthSpend: number;
    monthlyTarget: number;
    kind: BudgetAlertKind;
  },
): Promise<void> {
  const members = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, input.householdId));
  const memberUserIds = members.map((m) => m.userId);
  if (memberUserIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, memberUserIds),
        eq(users.pushExpenseBudgetAlertsEnabled, true),
      ),
    );
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  const spend = formatMoney(input.monthSpend);
  const target = formatMoney(input.monthlyTarget);
  const title =
    input.kind === "over" ? "Budget exceeded" : "Budget nearly full";
  const body =
    input.kind === "over"
      ? `${input.category}: ${spend} spent (target ${target})`
      : `${input.category}: ${spend} of ${target} this month`;

  const monthKey = todayMonthKey();
  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title,
    body,
    url: "/expenses",
    tag: `budget-${input.householdId}-${input.category}-${monthKey}-${input.kind}`,
  });
}

export async function checkHouseholdBudgetAlerts(
  db: Database,
  env: Env,
  householdId: string,
): Promise<number> {
  const monthKey = todayMonthKey();
  const budgets = await db
    .select()
    .from(expenseBudgets)
    .where(eq(expenseBudgets.householdId, householdId));

  let sent = 0;
  for (const budget of budgets) {
    if (budget.monthlyTarget <= 0) continue;
    const monthSpend = await sumCategorySpend(db, householdId, budget.category, monthKey);
    const ratio = monthSpend / budget.monthlyTarget;

    let kind: BudgetAlertKind | null = null;
    if (ratio >= 1) kind = "over";
    else if (ratio >= BUDGET_WARNING_RATIO) kind = "warning";
    if (!kind) continue;

    if (await alertAlreadySent(db, householdId, budget.category, monthKey, kind)) continue;

    await notifyBudgetAlert(db, env, {
      householdId,
      category: budget.category,
      monthSpend,
      monthlyTarget: budget.monthlyTarget,
      kind,
    });
    await markAlertSent(db, householdId, budget.category, monthKey, kind);
    sent += 1;
  }
  return sent;
}

export async function scanBudgetAlerts(db: Database, env: Env): Promise<number> {
  const households = await db
    .selectDistinct({ householdId: expenseBudgets.householdId })
    .from(expenseBudgets);

  let total = 0;
  for (const row of households) {
    total += await checkHouseholdBudgetAlerts(db, env, row.householdId);
  }
  return total;
}
