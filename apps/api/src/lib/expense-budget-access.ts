import type { AuthContext } from "@domi-ops/auth";
import type { Database } from "@domi-ops/db";
import {
  expenseBudgets,
  expenseBudgetShares,
  householdMembers,
  type expenseBudgets as expenseBudgetsTable,
} from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";

export type ExpenseBudgetShareAccess = "read" | "write";

export type ExpenseBudgetRow = typeof expenseBudgetsTable.$inferSelect;

const ACCESS_RANK: Record<ExpenseBudgetShareAccess, number> = { read: 1, write: 2 };

export function isHouseholdBudget(budget: Pick<ExpenseBudgetRow, "memberId">): boolean {
  return budget.memberId == null;
}

export function canViewBudget(
  auth: Pick<AuthContext, "memberId">,
  budget: Pick<ExpenseBudgetRow, "memberId">,
  shareAccess: ExpenseBudgetShareAccess | null,
): boolean {
  if (isHouseholdBudget(budget)) return true;
  if (budget.memberId === auth.memberId) return true;
  return shareAccess != null;
}

export function canWriteBudget(
  auth: Pick<AuthContext, "memberId">,
  budget: Pick<ExpenseBudgetRow, "memberId">,
  shareAccess: ExpenseBudgetShareAccess | null,
): boolean {
  if (isHouseholdBudget(budget)) return true;
  if (budget.memberId === auth.memberId) return true;
  return shareAccess === "write";
}

export function isBudgetOwner(
  auth: Pick<AuthContext, "memberId">,
  budget: Pick<ExpenseBudgetRow, "memberId">,
): boolean {
  return !isHouseholdBudget(budget) && budget.memberId === auth.memberId;
}

export async function loadBudgetShareAccessMap(
  db: Database,
  budgetIds: string[],
  granteeMemberId: string,
): Promise<Map<string, ExpenseBudgetShareAccess>> {
  const map = new Map<string, ExpenseBudgetShareAccess>();
  if (budgetIds.length === 0) return map;
  const rows = await db
    .select({
      budgetId: expenseBudgetShares.budgetId,
      access: expenseBudgetShares.access,
    })
    .from(expenseBudgetShares)
    .where(
      and(
        inArray(expenseBudgetShares.budgetId, budgetIds),
        eq(expenseBudgetShares.memberId, granteeMemberId),
      ),
    );
  for (const row of rows) {
    map.set(row.budgetId, row.access);
  }
  return map;
}

export async function loadBudgetShareRows(
  db: Database,
  budgetId: string,
): Promise<{ memberId: string; access: ExpenseBudgetShareAccess }[]> {
  const rows = await db
    .select({
      memberId: expenseBudgetShares.memberId,
      access: expenseBudgetShares.access,
    })
    .from(expenseBudgetShares)
    .where(eq(expenseBudgetShares.budgetId, budgetId));
  return rows;
}

/** Household budgets + owned personal + shared personal. */
export async function listVisibleBudgets(
  db: Database,
  auth: Pick<AuthContext, "householdId" | "memberId">,
): Promise<
  Array<
    ExpenseBudgetRow & {
      shareAccess: ExpenseBudgetShareAccess | null;
    }
  >
> {
  const rows = await db
    .select()
    .from(expenseBudgets)
    .where(eq(expenseBudgets.householdId, auth.householdId))
    .orderBy(expenseBudgets.category);

  const shareMap = await loadBudgetShareAccessMap(
    db,
    rows.map((r) => r.id),
    auth.memberId,
  );

  return rows
    .map((budget) => ({
      ...budget,
      shareAccess: shareMap.get(budget.id) ?? null,
    }))
    .filter((budget) => canViewBudget(auth, budget, budget.shareAccess));
}

export async function replaceExpenseBudgetShares(
  db: Database,
  budgetId: string,
  shares: { memberId: string; access: ExpenseBudgetShareAccess }[],
): Promise<void> {
  await db.delete(expenseBudgetShares).where(eq(expenseBudgetShares.budgetId, budgetId));
  if (shares.length === 0) return;
  await db.insert(expenseBudgetShares).values(
    shares.map((s) => ({
      budgetId,
      memberId: s.memberId,
      access: s.access,
    })),
  );
}

export async function validateBudgetShareMemberIds(
  db: Database,
  householdId: string,
  ownerMemberId: string,
  memberIds: string[],
): Promise<boolean> {
  if (memberIds.length === 0) return true;
  if (memberIds.some((id) => id === ownerMemberId)) return false;
  const unique = [...new Set(memberIds)];
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(eq(householdMembers.householdId, householdId), inArray(householdMembers.id, unique)),
    );
  return rows.length === unique.length;
}

export function shareAccessAtLeast(
  access: ExpenseBudgetShareAccess | null,
  min: ExpenseBudgetShareAccess,
): boolean {
  if (!access) return false;
  return ACCESS_RANK[access] >= ACCESS_RANK[min];
}

/** Member ids with write share on a personal budget (for alerts). */
export async function listPersonalBudgetWriteShareMemberIds(
  db: Database,
  budgetId: string,
): Promise<string[]> {
  const rows = await db
    .select({ memberId: expenseBudgetShares.memberId })
    .from(expenseBudgetShares)
    .where(
      and(eq(expenseBudgetShares.budgetId, budgetId), eq(expenseBudgetShares.access, "write")),
    );
  return rows.map((r) => r.memberId);
}
