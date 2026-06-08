"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Combobox, Input, Sheet } from "./ui";

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string | null;
  expenseDate: string;
}

export function ExpenseEditSheet({
  expense,
  categorySuggestions,
  onCategoryQuery,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  categorySuggestions: string[];
  onCategoryQuery: (query: string) => void;
  onClose: () => void;
  onSaved: (expense: Expense) => void;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) return;
    setTitle(expense.title);
    setAmount(String(expense.amount));
    setCategory(expense.category ?? "");
    setExpenseDate(expense.expenseDate);
    setError(null);
  }, [expense]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!expense) return;
    const parsed = parseFloat(amount);
    if (!title.trim() || Number.isNaN(parsed)) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.patch<{ expense: Expense }>(`/api/core/expenses/${expense.id}`, {
        title: title.trim(),
        amount: parsed,
        category: category.trim() || null,
        expenseDate,
      });
      onSaved(data.expense);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={expense !== null} onClose={onClose} title="Edit expense">
      <form className="space-y-4" onSubmit={save}>
        {error && <Alert variant="error">{error}</Alert>}
        <label className="block space-y-1">
          <span className="text-sm font-medium">Title</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Amount</span>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Category</span>
          <Combobox
            value={category}
            onChange={setCategory}
            suggestions={categorySuggestions}
            onQueryChange={onCategoryQuery}
            placeholder="Optional"
            aria-label="Category"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Date</span>
          <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} required />
        </label>
        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
