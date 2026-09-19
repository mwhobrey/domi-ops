import { AppShell } from "../../components/AppShell";
import { ExpensesList } from "../../components/ExpensesList";
import type { NoteShareMember } from "../../components/NoteSharePicker";
import { ModuleReportsLink } from "../../components/reports/ModuleReportsLink";
import { apiFetch } from "../../lib/api";
import { sessionMemberId, type AuthSessionResponse } from "../../lib/session";
import { Alert } from "../../components/ui";

export default async function ExpensesPage() {
  let expenses: {
    id: string;
    title: string;
    amount: number;
    category: string | null;
    expenseDate: string;
    memberId?: string | null;
  }[] = [];
  let members: NoteShareMember[] = [];
  let currentMemberId = "";
  let loadError: string | null = null;
  try {
    const [expRes, roster, session] = await Promise.all([
      apiFetch<{ expenses: typeof expenses }>("/api/core/expenses"),
      apiFetch<{ members: NoteShareMember[] }>("/api/core/household/roster"),
      apiFetch<AuthSessionResponse>("/auth/session"),
    ]);
    expenses = expRes.expenses;
    members = roster.members ?? [];
    currentMemberId = sessionMemberId(session);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load expenses";
  }

  return (
    <AppShell
      title="Expenses"
      actions={<ModuleReportsLink module="expenses" />}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/expenses">Retry</a>
        </Alert>
      ) : (
        <ExpensesList
          initialExpenses={expenses}
          members={members}
          currentMemberId={currentMemberId}
        />
      )}
    </AppShell>
  );
}
