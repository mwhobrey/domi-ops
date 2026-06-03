"use client";

import { useState } from "react";

interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string | null;
  expenseDate: string;
}

export function ExpensesList({ initialExpenses }: { initialExpenses: Expense[] }) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 sm:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = parseFloat(amount);
          if (!title.trim() || Number.isNaN(parsed)) return;
          const res = await fetch("/api/core/expenses", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title.trim(), amount: parsed, expenseDate }),
          });
          if (res.ok) {
            const data = (await res.json()) as { expense: Expense };
            setExpenses((prev) => [data.expense, ...prev]);
            setTitle("");
            setAmount("");
          }
        }}
      >
        <input
          className="rounded-xl border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="rounded-xl border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          type="date"
          className="rounded-xl border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
        />
        <button type="submit" className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
          Add expense
        </button>
      </form>
      <ul className="space-y-2">
        {expenses.map((ex) => (
          <li
            key={ex.id}
            className="flex items-center justify-between rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm"
          >
            <span>
              {ex.title}{" "}
              <span className="text-[var(--color-text-muted)]">({ex.expenseDate})</span>
            </span>
            <span className="font-medium">${ex.amount.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
