"use client";

import { useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Button, Card, Input } from "./ui";
import { ListPage, ListPageEmpty } from "./lists/ListPage";

interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string | null;
  expenseDate: string;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function ExpensesList({ initialExpenses }: { initialExpenses: Expense[] }) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)),
    [expenses],
  );

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
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Failed");
            } finally {
              setLoading(false);
            }
          }}
        >
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          <Button type="submit" loading={loading}>
            Add
          </Button>
        </form>
      }
    >
      {sorted.length === 0 ? (
        <ListPageEmpty title="No expenses" description="Track spending above." />
      ) : (
        <ul className="space-y-2">
          {sorted.map((ex) => (
            <li
              key={ex.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 px-4 py-3 text-sm"
            >
              <div>
                <span className="font-medium">{ex.title}</span>
                <span className="ml-2 text-[var(--color-text-muted)]">{ex.expenseDate}</span>
                {ex.category && (
                  <span className="ml-2 rounded-full bg-[var(--color-border)]/50 px-2 py-0.5 text-xs">
                    {ex.category}
                  </span>
                )}
              </div>
              <span className="font-semibold">{formatMoney(ex.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </ListPage>
  );
}
