"use client";

import { Receipt } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { ExpenseEditSheet, type Expense } from "./ExpenseEditSheet";
import {
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  EmptyState,
  Input,
  ListItem,
  SectionHeader,
  StatTile,
} from "./ui";
import { ListPage } from "./lists/ListPage";

interface BudgetSummary {
  id: string;
  category: string;
  monthlyTarget: number;
  monthSpend: number;
  percentUsed: number;
  status: "under" | "warning" | "over";
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function budgetBarTone(status: BudgetSummary["status"]): string {
  if (status === "over") return "bg-[var(--color-danger)]";
  if (status === "warning") return "bg-[var(--color-warning,#f59e0b)]";
  return "bg-[var(--color-accent)]";
}

function BudgetProgress({ budget }: { budget: BudgetSummary }) {
  const width = Math.min(budget.percentUsed, 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{budget.category}</span>
        <span className="tabular-nums text-[var(--color-text-muted)]">
          {formatMoney(budget.monthSpend)} / {formatMoney(budget.monthlyTarget)}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]"
        role="progressbar"
        aria-valuenow={budget.percentUsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${budget.category} budget: ${budget.percentUsed}% used`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${budgetBarTone(budget.status)}`}
          style={{ width: `${width}%` }}
        />
      </div>
      {budget.status !== "under" && (
        <Badge tone={budget.status === "over" ? "warning" : "accent"} className="text-xs">
          {budget.status === "over" ? "Over budget" : "Nearly full"}
        </Badge>
      )}
    </div>
  );
}

export function ExpensesList({ initialExpenses }: { initialExpenses: Expense[] }) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [budgets, setBudgets] = useState<BudgetSummary[]>([]);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [budgetCategory, setBudgetCategory] = useState("");
  const [budgetTarget, setBudgetTarget] = useState("");
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [deleteBudgetId, setDeleteBudgetId] = useState<string | null>(null);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editBudgetTarget, setEditBudgetTarget] = useState("");

  const fetchCategorySuggestions = useCallback(async (q: string) => {
    try {
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/api/core/expenses/category-suggestions${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      );
      setCategorySuggestions(data.suggestions);
    } catch {
      /* non-fatal */
    }
  }, []);

  const fetchBudgets = useCallback(async () => {
    try {
      const data = await apiClient.get<{ budgets: BudgetSummary[] }>("/api/core/expenses/budgets");
      setBudgets(data.budgets);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void fetchCategorySuggestions("");
    void fetchBudgets();
  }, [fetchCategorySuggestions, fetchBudgets]);

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)),
    [expenses],
  );

  const monthTotal = useMemo(() => {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return expenses
      .filter((e) => e.expenseDate.startsWith(prefix))
      .reduce((sum, e) => sum + e.amount, 0);
  }, [expenses]);

  return (
    <ListPage
      error={error}
      onDismissError={() => setError(null)}
      addForm={
        <form
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = parseFloat(amount);
            if (!title.trim() || Number.isNaN(parsed)) return;
            setLoading(true);
            try {
              const data = await apiClient.post<{ expense: Expense }>("/api/core/expenses", {
                title: title.trim(),
                amount: parsed,
                category: category.trim() || undefined,
                expenseDate,
              });
              setExpenses((prev) => [data.expense, ...prev]);
              setTitle("");
              setAmount("");
              setCategory("");
              void fetchBudgets();
              void fetchCategorySuggestions("");
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Failed");
            } finally {
              setLoading(false);
            }
          }}
        >
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Expense title"
          />
          <Input
            placeholder="Amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount"
          />
          <Combobox
            value={category}
            onChange={setCategory}
            suggestions={categorySuggestions}
            onQueryChange={(q) => void fetchCategorySuggestions(q)}
            placeholder="Category"
            aria-label="Category"
          />
          <Input
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            aria-label="Expense date"
          />
          <Button type="submit" loading={loading}>
            Add
          </Button>
        </form>
      }
    >
      {sorted.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="This month" value={formatMoney(monthTotal)} href="/expenses" />
        </div>
      )}

      <section className="mb-6 space-y-3">
        <SectionHeader title="Monthly budgets" />
        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const target = parseFloat(budgetTarget);
            if (!budgetCategory.trim() || Number.isNaN(target) || target <= 0) return;
            setBudgetLoading(true);
            try {
              const data = await apiClient.post<{ budget: BudgetSummary }>(
                "/api/core/expenses/budgets",
                { category: budgetCategory.trim(), monthlyTarget: target },
              );
              setBudgets((prev) => {
                const rest = prev.filter((b) => b.id !== data.budget.id);
                return [...rest, data.budget].sort((a, b) =>
                  a.category.localeCompare(b.category),
                );
              });
              setBudgetCategory("");
              setBudgetTarget("");
            } catch (err) {
              if (err instanceof ApiError && err.body?.includes("duplicate_category")) {
                setError("A budget for that category already exists.");
              } else {
                setError(err instanceof ApiError ? err.message : "Failed to add budget");
              }
            } finally {
              setBudgetLoading(false);
            }
          }}
        >
          <Combobox
            value={budgetCategory}
            onChange={setBudgetCategory}
            suggestions={categorySuggestions}
            onQueryChange={(q) => void fetchCategorySuggestions(q)}
            placeholder="Category"
            aria-label="Budget category"
          />
          <Input
            placeholder="Monthly target"
            inputMode="decimal"
            value={budgetTarget}
            onChange={(e) => setBudgetTarget(e.target.value)}
            aria-label="Monthly target amount"
          />
          <Button type="submit" loading={budgetLoading} variant="secondary">
            Set budget
          </Button>
        </form>
        {budgets.length > 0 ? (
          <ul className="space-y-3">
            {budgets.map((b) => (
              <ListItem key={b.id} as="li" className="flex-col items-stretch gap-2">
                <BudgetProgress budget={b} />
                {editingBudgetId === b.id ? (
                  <form
                    className="flex flex-wrap items-center justify-end gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const parsed = parseFloat(editBudgetTarget);
                      if (Number.isNaN(parsed) || parsed <= 0) {
                        setError("Enter a positive amount.");
                        return;
                      }
                      try {
                        const data = await apiClient.patch<{ budget: BudgetSummary }>(
                          `/api/core/expenses/budgets/${b.id}`,
                          { monthlyTarget: parsed },
                        );
                        setBudgets((prev) =>
                          prev.map((x) => (x.id === data.budget.id ? data.budget : x)),
                        );
                        setEditingBudgetId(null);
                      } catch {
                        setError("Could not update budget");
                      }
                    }}
                  >
                    <Input
                      inputMode="decimal"
                      value={editBudgetTarget}
                      onChange={(e) => setEditBudgetTarget(e.target.value)}
                      aria-label={`New target for ${b.category}`}
                      className="max-w-[8rem]"
                    />
                    <Button type="submit" size="sm">
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingBudgetId(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingBudgetId(b.id);
                        setEditBudgetTarget(String(b.monthlyTarget));
                      }}
                    >
                      Edit target
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteBudgetId(b.id)}>
                      Remove
                    </Button>
                  </div>
                )}
              </ListItem>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            Set a target per category to track spend vs budget this month.
          </p>
        )}
      </section>

      {sorted.length === 0 ? (
        <EmptyState
          title="No expenses"
          description="Track spending above."
          icon={<Receipt className="h-10 w-10" />}
        />
      ) : (
        <ul className="space-y-2">
          {sorted.map((ex) => (
            <ListItem key={ex.id} as="li" className="flex-wrap justify-between text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{ex.title}</span>
                <span className="ml-2 text-[var(--color-text-muted)]">{ex.expenseDate}</span>
                {ex.category && (
                  <Badge tone="default" className="ml-2">
                    {ex.category}
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-semibold tabular-nums">{formatMoney(ex.amount)}</span>
                <Button variant="ghost" size="sm" onClick={() => setEditExpense(ex)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteId(ex.id)}>
                  Remove
                </Button>
              </div>
            </ListItem>
          ))}
        </ul>
      )}

      <ExpenseEditSheet
        expense={editExpense}
        categorySuggestions={categorySuggestions}
        onCategoryQuery={(q) => void fetchCategorySuggestions(q)}
        onClose={() => setEditExpense(null)}
        onSaved={(updated) => {
          setExpenses((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          void fetchBudgets();
        }}
      />

      <ConfirmDialog
        open={deleteId !== null}
        title="Remove expense?"
        message="This cannot be undone."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!deleteId) return;
          const id = deleteId;
          setDeleteId(null);
          setExpenses((prev) => prev.filter((x) => x.id !== id));
          await apiClient.delete(`/api/core/expenses/${id}`).catch(() => setError("Delete failed"));
          void fetchBudgets();
        }}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={deleteBudgetId !== null}
        title="Remove budget?"
        message="Spending history is kept; only the target is removed."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!deleteBudgetId) return;
          const id = deleteBudgetId;
          setDeleteBudgetId(null);
          setBudgets((prev) => prev.filter((x) => x.id !== id));
          await apiClient
            .delete(`/api/core/expenses/budgets/${id}`)
            .catch(() => setError("Could not remove budget"));
        }}
        onCancel={() => setDeleteBudgetId(null)}
      />
    </ListPage>
  );
}
