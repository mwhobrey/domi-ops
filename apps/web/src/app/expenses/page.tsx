import { AppShell } from "../../components/AppShell";
import { ExpensesList } from "../../components/ExpensesList";
import { apiFetch } from "../../lib/api";

interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string | null;
  expenseDate: string;
}

export default async function ExpensesPage() {
  let expenses: Expense[] = [];
  try {
    const res = await apiFetch<{ expenses: Expense[] }>("/api/core/expenses");
    expenses = res.expenses;
  } catch {
    /* */
  }

  return (
    <AppShell title="Expenses">
      <ExpensesList initialExpenses={expenses} />
    </AppShell>
  );
}
