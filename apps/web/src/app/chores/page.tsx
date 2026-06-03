import { AppShell } from "../../components/AppShell";
import { ChoresList } from "../../components/ChoresList";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

export default async function ChoresPage() {
  let chores: { id: string; description: string; done: boolean; dueDate: string | null }[] = [];
  let loadError: string | null = null;
  try {
    const res = await apiFetch<{ chores: typeof chores }>("/api/core/chores");
    chores = res.chores;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load chores";
  }

  return (
    <AppShell title="Chores" description="Household tasks and due dates">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/chores">Retry</a>
        </Alert>
      ) : (
        <ChoresList initialChores={chores} />
      )}
    </AppShell>
  );
}
