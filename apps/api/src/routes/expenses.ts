import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { expenseBudgets, expenses, householdMembers } from "@domi-ops/db";
import { and, desc, eq } from "drizzle-orm";
import { checkHouseholdBudgetAlerts } from "@domi-ops/calendar-sync";
import {
  buildExpenseReports,
  collectExpenseCategorySuggestions,
  currentMonthKey,
  normalizeExpenseCategory,
  normalizeMonthKey,
  serializeExpense,
  summarizeBudgetRow,
} from "../lib/expenses.js";
import {
  canWriteBudget,
  isBudgetOwner,
  listVisibleBudgets,
  loadBudgetShareRows,
  replaceExpenseBudgetShares,
  validateBudgetShareMemberIds,
  type ExpenseBudgetShareAccess,
} from "../lib/expense-budget-access.js";
import { buildExpensesGlance } from "../lib/expenses-glance.js";
import { posterLabel } from "../lib/poster-label.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function expensesRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/expenses/glance", async (c) => {
    const auth = c.get("auth")!;
    const visible = await listVisibleBudgets(db, auth);
    const monthKey = currentMonthKey();
    const budgets = await Promise.all(
      visible.map((budget) => summarizeBudgetRow(db, budget, monthKey)),
    );
    return c.json(buildExpensesGlance(budgets));
  });

  app.get("/expenses/category-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectExpenseCategorySuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/expenses/reports", async (c) => {
    const auth = c.get("auth")!;
    const monthQuery = c.req.query("month")?.trim();
    if (monthQuery && !normalizeMonthKey(monthQuery)) {
      return c.json({ error: "invalid_month" }, 400);
    }
    const scope =
      c.req.query("scope")?.trim() === "personal" ? ("personal" as const) : ("household" as const);
    const report = await buildExpenseReports(db, auth.householdId, monthQuery, {
      scope,
      memberId: scope === "personal" ? auth.memberId : undefined,
    });
    return c.json(report);
  });

  app.get("/expenses/budgets", async (c) => {
    const auth = c.get("auth")!;
    const visible = await listVisibleBudgets(db, auth);
    const monthKey = currentMonthKey();
    const budgets = [];
    for (const budget of visible) {
      const shares =
        budget.memberId && isBudgetOwner(auth, budget)
          ? await loadBudgetShareRows(db, budget.id)
          : budget.shareAccess
            ? await loadBudgetShareRows(db, budget.id).then((rows) =>
                rows.filter((r) => r.memberId === auth.memberId),
              )
            : [];
      budgets.push(
        await summarizeBudgetRow(db, budget, monthKey, {
          shareAccess: budget.shareAccess,
          shares,
        }),
      );
    }
    return c.json({ budgets });
  });

  app.post("/expenses/budgets", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      category?: string;
      monthlyTarget?: number;
      scope?: string;
    }>();
    const category = normalizeExpenseCategory(body.category);
    const monthlyTarget = Number(body.monthlyTarget);
    const personal = body.scope === "personal";
    if (!category || Number.isNaN(monthlyTarget) || monthlyTarget <= 0) {
      return c.json({ error: "invalid_budget" }, 400);
    }
    try {
      const [row] = await db
        .insert(expenseBudgets)
        .values({
          householdId: auth.householdId,
          category,
          monthlyTarget,
          memberId: personal ? auth.memberId : null,
        })
        .returning();
      const budget = await summarizeBudgetRow(db, row, currentMonthKey(), {
        shareAccess: null,
        shares: [],
      });
      return c.json({ budget }, 201);
    } catch {
      return c.json({ error: "duplicate_category" }, 409);
    }
  });

  app.patch("/expenses/budgets/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{ monthlyTarget?: number }>();
    const monthlyTarget = Number(body.monthlyTarget);
    if (Number.isNaN(monthlyTarget) || monthlyTarget <= 0) {
      return c.json({ error: "invalid_budget" }, 400);
    }
    const [existing] = await db
      .select()
      .from(expenseBudgets)
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const visible = await listVisibleBudgets(db, auth);
    const access = visible.find((b) => b.id === id);
    if (!access || !canWriteBudget(auth, existing, access.shareAccess)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const [row] = await db
      .update(expenseBudgets)
      .set({ monthlyTarget })
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    const shares = await loadBudgetShareRows(db, row.id);
    const budget = await summarizeBudgetRow(db, row, currentMonthKey(), {
      shareAccess: access.shareAccess,
      shares: isBudgetOwner(auth, row) ? shares : shares.filter((s) => s.memberId === auth.memberId),
    });
    return c.json({ budget });
  });

  app.delete("/expenses/budgets/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(expenseBudgets)
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const visible = await listVisibleBudgets(db, auth);
    const access = visible.find((b) => b.id === id);
    if (!access || !canWriteBudget(auth, existing, access.shareAccess)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const [row] = await db
      .delete(expenseBudgets)
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .returning({ id: expenseBudgets.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.put("/expenses/budgets/:id/shares", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(expenseBudgets)
      .where(and(eq(expenseBudgets.id, id), eq(expenseBudgets.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (!existing.memberId || !isBudgetOwner(auth, existing)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      shares?: { memberId?: string; access?: string }[];
    }>();
    const shares: { memberId: string; access: ExpenseBudgetShareAccess }[] = [];
    for (const raw of body.shares ?? []) {
      if (!raw.memberId || (raw.access !== "read" && raw.access !== "write")) {
        return c.json({ error: "invalid_shares" }, 400);
      }
      shares.push({ memberId: raw.memberId, access: raw.access });
    }
    if (
      !(await validateBudgetShareMemberIds(
        db,
        auth.householdId,
        existing.memberId,
        shares.map((s) => s.memberId),
      ))
    ) {
      return c.json({ error: "invalid_shares" }, 400);
    }
    await replaceExpenseBudgetShares(db, id, shares);
    return c.json({ shares: await loadBudgetShareRows(db, id) });
  });

  app.get("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.householdId, auth.householdId))
      .orderBy(desc(expenses.expenseDate))
      .limit(200);
    return c.json({ expenses: rows.map(serializeExpense) });
  });

  app.post("/expenses", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title: string;
      amount: number;
      category?: string;
      expenseDate: string;
      memberId?: string | null;
    }>();
    const title = body.title?.trim();
    const amount = Number(body.amount);
    if (!title || Number.isNaN(amount) || amount < 0) {
      return c.json({ error: "invalid_expense" }, 400);
    }
    let memberId: string | null = auth.memberId;
    if (body.memberId === null) {
      memberId = null;
    } else if (typeof body.memberId === "string") {
      const [member] = await db
        .select({ id: householdMembers.id })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.id, body.memberId),
            eq(householdMembers.householdId, auth.householdId),
          ),
        )
        .limit(1);
      if (!member) return c.json({ error: "invalid_member" }, 400);
      memberId = member.id;
    }
    const [row] = await db
      .insert(expenses)
      .values({
        householdId: auth.householdId,
        title,
        amount,
        category: normalizeExpenseCategory(body.category),
        expenseDate: body.expenseDate,
        memberId,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    void checkHouseholdBudgetAlerts(db, env, auth.householdId).catch(() => {});
    return c.json({ expense: serializeExpense(row) }, 201);
  });

  app.patch("/expenses/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      amount?: number;
      category?: string | null;
      expenseDate?: string;
      memberId?: string | null;
    }>();
    const patch: {
      title?: string;
      amount?: number;
      category?: string | null;
      expenseDate?: string;
      memberId?: string | null;
    } = {};
    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) return c.json({ error: "invalid_expense" }, 400);
      patch.title = title;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (Number.isNaN(amount) || amount < 0) return c.json({ error: "invalid_expense" }, 400);
      patch.amount = amount;
    }
    if (body.category !== undefined) {
      patch.category = normalizeExpenseCategory(body.category);
    }
    if (body.expenseDate !== undefined) patch.expenseDate = body.expenseDate;
    if (body.memberId === null) {
      patch.memberId = null;
    } else if (typeof body.memberId === "string") {
      const [member] = await db
        .select({ id: householdMembers.id })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.id, body.memberId),
            eq(householdMembers.householdId, auth.householdId),
          ),
        )
        .limit(1);
      if (!member) return c.json({ error: "invalid_member" }, 400);
      patch.memberId = member.id;
    }

    const [row] = await db
      .update(expenses)
      .set(patch)
      .where(and(eq(expenses.id, id), eq(expenses.householdId, auth.householdId)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    void checkHouseholdBudgetAlerts(db, env, auth.householdId).catch(() => {});
    return c.json({ expense: serializeExpense(row) });
  });

  app.delete("/expenses/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [row] = await db
      .delete(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.householdId, auth.householdId)))
      .returning({ id: expenses.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
