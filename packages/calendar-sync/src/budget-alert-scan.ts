import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  expenseBudgetAlertSent,
  expenseBudgetShares,
  expenseBudgets,
  expenses,
  householdMembers,
  users,
} from "@domi-ops/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
  memberId: string | null,
): Promise<number> {
  const conditions = [
    eq(expenses.householdId, householdId),
    sql`lower(trim(${expenses.category})) = ${category.trim().toLowerCase()}`,
    sql`to_char(${expenses.expenseDate}, 'YYYY-MM') = ${monthKey}`,
  ];
  if (memberId) {
    conditions.push(eq(expenses.memberId, memberId));
  }
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

async function alertAlreadySent(
  db: Database,
  householdId: string,
  category: string,
  monthKey: string,
  kind: BudgetAlertKind,
  memberId: string | null,
): Promise<boolean> {
  const conditions = [
    eq(expenseBudgetAlertSent.householdId, householdId),
    eq(expenseBudgetAlertSent.category, category),
    eq(expenseBudgetAlertSent.monthKey, monthKey),
    eq(expenseBudgetAlertSent.alertKind, kind),
  ];
  if (memberId) {
    conditions.push(eq(expenseBudgetAlertSent.memberId, memberId));
  } else {
    conditions.push(isNull(expenseBudgetAlertSent.memberId));
  }
  const [row] = await db
    .select({ id: expenseBudgetAlertSent.id })
    .from(expenseBudgetAlertSent)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
}

async function markAlertSent(
  db: Database,
  householdId: string,
  category: string,
  monthKey: string,
  kind: BudgetAlertKind,
  memberId: string | null,
): Promise<void> {
  await db.insert(expenseBudgetAlertSent).values({
    householdId,
    category,
    monthKey,
    alertKind: kind,
    memberId,
  });
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/** Owner + write sharees for personal budgets; full household set when `memberId` is null. */
export function budgetAlertMemberIds(input: {
  ownerMemberId: string | null;
  writeShareMemberIds: string[];
  householdMemberIds: string[];
}): string[] {
  if (!input.ownerMemberId) {
    return [...new Set(input.householdMemberIds)];
  }
  return [...new Set([input.ownerMemberId, ...input.writeShareMemberIds])];
}

async function recipientUserIdsForBudget(
  db: Database,
  budget: { id: string; householdId: string; memberId: string | null },
): Promise<string[]> {
  if (!budget.memberId) {
    const members = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, budget.householdId));
    return members.map((m) => m.userId).filter((id): id is string => Boolean(id));
  }

  const writeShares = await db
    .select({ memberId: expenseBudgetShares.memberId })
    .from(expenseBudgetShares)
    .where(
      and(eq(expenseBudgetShares.budgetId, budget.id), eq(expenseBudgetShares.access, "write")),
    );
  const memberIds = budgetAlertMemberIds({
    ownerMemberId: budget.memberId,
    writeShareMemberIds: writeShares.map((s) => s.memberId),
    householdMemberIds: [],
  });
  const members = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(inArray(householdMembers.id, memberIds));
  return members.map((m) => m.userId).filter((id): id is string => Boolean(id));
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
    memberId: string | null;
    userIds: string[];
  },
): Promise<void> {
  if (input.userIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(inArray(users.id, input.userIds), eq(users.pushExpenseBudgetAlertsEnabled, true)),
    );
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  const spend = formatMoney(input.monthSpend);
  const target = formatMoney(input.monthlyTarget);
  const scopeLabel = input.memberId ? "Personal budget" : "Budget";
  const title =
    input.kind === "over" ? `${scopeLabel} exceeded` : `${scopeLabel} nearly full`;
  const body =
    input.kind === "over"
      ? `${input.category}: ${spend} spent (target ${target})`
      : `${input.category}: ${spend} of ${target} this month`;

  const monthKey = todayMonthKey();
  const tagScope = input.memberId ?? "household";
  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title,
    body,
    url: "/expenses",
    tag: `budget-${input.householdId}-${tagScope}-${input.category}-${monthKey}-${input.kind}`,
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
    const monthSpend = await sumCategorySpend(
      db,
      householdId,
      budget.category,
      monthKey,
      budget.memberId,
    );
    const ratio = monthSpend / budget.monthlyTarget;

    let kind: BudgetAlertKind | null = null;
    if (ratio >= 1) kind = "over";
    else if (ratio >= BUDGET_WARNING_RATIO) kind = "warning";
    if (!kind) continue;

    if (
      await alertAlreadySent(db, householdId, budget.category, monthKey, kind, budget.memberId)
    ) {
      continue;
    }

    const userIds = await recipientUserIdsForBudget(db, budget);
    await notifyBudgetAlert(db, env, {
      householdId,
      category: budget.category,
      monthSpend,
      monthlyTarget: budget.monthlyTarget,
      kind,
      memberId: budget.memberId,
      userIds,
    });
    await markAlertSent(db, householdId, budget.category, monthKey, kind, budget.memberId);
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
