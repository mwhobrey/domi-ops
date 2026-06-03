import { AppShell } from "../../components/AppShell";
import { ExpensesList } from "../../components/ExpensesList";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

export default async function ExpensesPage() {
  let expenses: {
    id: string;
    title: string;
    amount: number;
    category: string | null;
    expenseDate: string;
  }[] = [];
  let loadError: string | null = null;
  try {
    const res = await apiFetch<{ expenses: typeof expenses }>("/api/core/expenses");
    expenses = res.expenses;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load expenses";
  }

  return (
    <AppShell title="Expenses" description="Track household spending">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/expenses">Retry</a>
        </Alert>
      ) : (
        <ExpensesList initialExpenses={expenses} />
      )}
    </AppShell>
  );
}
