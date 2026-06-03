import { AppShell } from "../../components/AppShell";
import { ChoresList } from "../../components/ChoresList";
import { apiFetch } from "../../lib/api";

interface Chore {
  id: string;
  description: string;
  done: boolean;
  dueDate: string | null;
}

export default async function ChoresPage() {
  let chores: Chore[] = [];
  try {
    const res = await apiFetch<{ chores: Chore[] }>("/api/core/chores");
    chores = res.chores;
  } catch {
    /* */
  }

  return (
    <AppShell title="Chores">
      <ChoresList initialChores={chores} />
    </AppShell>
  );
}
