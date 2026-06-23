import { Suspense } from "react";
import { AppShell } from "../../components/AppShell";
import { ReportsHubClient } from "../../components/reports/ReportsHubClient";

export default function ReportsPage() {
  return (
    <AppShell title="Reports">
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
