import { Suspense } from "react";
import { AppShell } from "../../components/AppShell";
import { ReportsHubClient } from "../../components/reports/ReportsHubClient";

export default function ReportsPage() {
  return (
    <AppShell
      title="Reports"
      description="Household reports across school, chores, shopping, expenses, and health"
    >
      <Suspense
        fallback={
          <p className="text-sm text-[var(--color-text-muted)]">Loading reports…</p>
        }
      >
        <ReportsHubClient />
      </Suspense>
    </AppShell>
  );
}
