import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { expenseBudgets, expenseRecurring, expenses, householdMembers } from "@domi-ops/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { checkHouseholdBudgetAlerts } from "@domi-ops/calendar-sync";
import {
  buildExpenseReports,
  collectExpenseCategorySuggestions,
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
import {
  materializeDueBills,
  nextBillDateOnOrAfter,
  normalizeBillInterval,
  serializeExpenseRecurring,
} from "../lib/expense-recurring.js";
import { householdMonthKey, householdTodayIsoDate } from "../lib/household-time.js";
import { posterLabel } from "../lib/poster-label.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function expensesRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  /** Posts due bills before anything reads spend, so budgets and totals include them. */
  async function postDueBills(householdId: string) {
    const created = await materializeDueBills(db, householdId);
    if (created > 0) void checkHouseholdBudgetAlerts(db, env, householdId).catch(() => {});
  }

  async function memberInHousehold(householdId: string, memberId: string): Promise<boolean> {
    const [member] = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(and(eq(householdMembers.id, memberId), eq(householdMembers.householdId, householdId)))
      .limit(1);
    return Boolean(member);
  }

  app.get("/expenses/glance", async (c) => {
    const auth = c.get("auth")!;
    await postDueBills(auth.householdId);
    const visible = await listVisibleBudgets(db, auth);
    const monthKey = (await householdMonthKey(db, auth.householdId));
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
    await postDueBills(auth.householdId);
    const report = await buildExpenseReports(db, auth.householdId, monthQuery, {
      scope,
      memberId: scope === "personal" ? auth.memberId : undefined,
    });
    return c.json(report);
  });

  app.get("/expenses/budgets", async (c) => {
    const auth = c.get("auth")!;
    await postDueBills(auth.householdId);
    const visible = await listVisibleBudgets(db, auth);
    const monthKey = (await householdMonthKey(db, auth.householdId));
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
      const budget = await summarizeBudgetRow(db, row, (await householdMonthKey(db, auth.householdId)), {
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
    const budget = await summarizeBudgetRow(db, row, (await householdMonthKey(db, auth.householdId)), {
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

  app.get("/expenses/recurring", async (c) => {
    const auth = c.get("auth")!;
    await postDueBills(auth.householdId);
    const rows = await db
      .select()
      .from(expenseRecurring)
      .where(eq(expenseRecurring.householdId, auth.householdId))
      .orderBy(asc(expenseRecurring.nextAt));
    return c.json({ recurring: rows.map(serializeExpenseRecurring) });
  });

  app.post("/expenses/recurring", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title?: string;
      amount?: number;
      category?: string;
      memberId?: string | null;
      interval?: string;
      startDate?: string;
    }>();
    const title = body.title?.trim();
    const amount = Number(body.amount);
    const interval = normalizeBillInterval(body.interval);
    if (!title || Number.isNaN(amount) || amount < 0 || !interval) {
      return c.json({ error: "invalid_bill" }, 400);
    }
    if (!body.startDate || !ISO_DATE.test(body.startDate)) {
      return c.json({ error: "invalid_start_date" }, 400);
    }
    let memberId: string | null = auth.memberId;
    if (body.memberId === null) memberId = null;
    else if (typeof body.memberId === "string") {
      if (!(await memberInHousehold(auth.householdId, body.memberId))) {
        return c.json({ error: "invalid_member" }, 400);
      }
      memberId = body.memberId;
    }
    // A start date in the past schedules the next due date; it never back-fills old bills.
    const today = await householdTodayIsoDate(db, auth.householdId);
    const [row] = await db
      .insert(expenseRecurring)
      .values({
        householdId: auth.householdId,
        title: title.slice(0, 256),
        amount,
        category: normalizeExpenseCategory(body.category),
        memberId,
        interval,
        anchorDate: body.startDate,
        nextAt: nextBillDateOnOrAfter(interval, body.startDate, today),
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    await postDueBills(auth.householdId);
    const [fresh] = await db
      .select()
      .from(expenseRecurring)
      .where(eq(expenseRecurring.id, row!.id))
      .limit(1);
    return c.json({ recurring: serializeExpenseRecurring(fresh ?? row!) }, 201);
  });

  app.patch("/expenses/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      amount?: number;
      category?: string | null;
      memberId?: string | null;
      interval?: string;
      startDate?: string;
      enabled?: boolean;
    }>();
    const [existing] = await db
      .select()
      .from(expenseRecurring)
      .where(and(eq(expenseRecurring.id, id), eq(expenseRecurring.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof expenseRecurring.$inferInsert> = {};
    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) return c.json({ error: "invalid_bill" }, 400);
      patch.title = title.slice(0, 256);
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (Number.isNaN(amount) || amount < 0) return c.json({ error: "invalid_bill" }, 400);
      patch.amount = amount;
    }
    if (body.category !== undefined) patch.category = normalizeExpenseCategory(body.category);
    if (body.memberId === null) patch.memberId = null;
    else if (typeof body.memberId === "string") {
      if (!(await memberInHousehold(auth.householdId, body.memberId))) {
        return c.json({ error: "invalid_member" }, 400);
      }
      patch.memberId = body.memberId;
    }
    if (body.interval !== undefined) {
      const interval = normalizeBillInterval(body.interval);
      if (!interval) return c.json({ error: "invalid_bill" }, 400);
      patch.interval = interval;
    }
    if (body.startDate !== undefined) {
      if (!ISO_DATE.test(body.startDate)) return c.json({ error: "invalid_start_date" }, 400);
      patch.anchorDate = body.startDate;
    }
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);

    // Rescheduling or resuming picks up from today; a paused stretch is never back-filled.
    const resumed = patch.enabled === true && !existing.enabled;
    const rescheduled =
      (patch.interval !== undefined && patch.interval !== existing.interval) ||
      (patch.anchorDate !== undefined && patch.anchorDate !== existing.anchorDate);
    if (rescheduled || resumed) {
      const interval = normalizeBillInterval(patch.interval ?? existing.interval) ?? "monthly";
      const today = await householdTodayIsoDate(db, auth.householdId);
      patch.nextAt = nextBillDateOnOrAfter(interval, patch.anchorDate ?? existing.anchorDate, today);
    }

    const [row] = await db
      .update(expenseRecurring)
      .set(patch)
      .where(and(eq(expenseRecurring.id, id), eq(expenseRecurring.householdId, auth.householdId)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    await postDueBills(auth.householdId);
    const [fresh] = await db
      .select()
      .from(expenseRecurring)
      .where(eq(expenseRecurring.id, row.id))
      .limit(1);
    return c.json({ recurring: serializeExpenseRecurring(fresh ?? row) });
  });

  app.delete("/expenses/recurring/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    // Expenses it already posted stay; the FK sets their recurring_id to null.
    const [row] = await db
      .delete(expenseRecurring)
      .where(and(eq(expenseRecurring.id, id), eq(expenseRecurring.householdId, auth.householdId)))
      .returning({ id: expenseRecurring.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/expenses", async (c) => {
    const auth = c.get("auth")!;
    await postDueBills(auth.householdId);
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
    if (!body.expenseDate || !ISO_DATE.test(body.expenseDate)) {
      return c.json({ error: "invalid_expense_date" }, 400);
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
    if (body.expenseDate !== undefined) {
      if (!ISO_DATE.test(body.expenseDate)) return c.json({ error: "invalid_expense_date" }, 400);
      patch.expenseDate = body.expenseDate;
    }
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
