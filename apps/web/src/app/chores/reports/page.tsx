import { AppShell } from "../../../components/AppShell";
import { ChoresReportsClient } from "../../../components/ChoresReportsClient";
import { LinkButton } from "../../../components/ui";

export default function ChoresReportsPage() {
  return (
    <AppShell
      title="Chore reports"
      description="Completions by person — on-time, early, and redemption quests"
      breadcrumb={[
        { label: "Chores", href: "/chores" },
        { label: "Reports" },
      ]}
      actions={
        <LinkButton href="/chores" variant="ghost" size="sm">
          Back to list
        </LinkButton>
      }
    >
      <ChoresReportsClient />
    </AppShell>
  );
}
