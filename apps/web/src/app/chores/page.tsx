import { AppShell } from "../../components/AppShell";
import { ChoresList, type Chore, type ChoreRecurring } from "../../components/ChoresList";
import type { MemberKarma } from "../../components/ChoreKarmaBar";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

export default async function ChoresPage() {
  let chores: Chore[] = [];
  let recurring: ChoreRecurring[] = [];
  let members: { memberId: string; label: string }[] = [];
  let karma: MemberKarma[] = [];
  let loadError: string | null = null;
  try {
    const [choresRes, membersRes, karmaRes] = await Promise.all([
      apiFetch<{ chores: Chore[] }>("/api/core/chores"),
      apiFetch<{
        members: Array<{
          memberId: string;
          name: string | null;
          username: string | null;
          email: string | null;
        }>;
      }>("/api/core/household/members"),
      apiFetch<{ members: MemberKarma[] }>("/api/core/chores/karma").catch(() => ({
        members: [] as MemberKarma[],
      })),
    ]);
    chores = choresRes.chores;
    karma = karmaRes.members;
    members = membersRes.members.map((m) => ({
      memberId: m.memberId,
      label: m.name?.trim() || m.username || m.email || "Member",
    }));
    recurring = await loadRecurring();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load chores";
  }

  return (
    <AppShell title="Chores">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/chores">Retry</a>
        </Alert>
      ) : (
        <ChoresList
          initialChores={chores}
          initialRecurring={recurring}
          members={members}
          initialKarma={karma}
        />
      )}
    </AppShell>
  );
}

async function loadRecurring(): Promise<ChoreRecurring[]> {
  try {
    const res = await apiFetch<{ recurring: ChoreRecurring[] }>("/api/core/chores/recurring");
    return res.recurring;
  } catch {
    return [];
  }
}
