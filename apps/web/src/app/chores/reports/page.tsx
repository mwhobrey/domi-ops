import { AppShell } from "../../../components/AppShell";
import { ChoresReportsClient } from "../../../components/ChoresReportsClient";

// DIAGNOSTIC (2026-08-30): breadcrumb/actions temporarily removed to test whether their
// presence on the *real* page (independent of loading.tsx's shape) is what breaks the
// Suspense-stream reveal. To be restored once the root cause is confirmed either way.
export default function ChoresReportsPage() {
  return (
    <AppShell title="Chore reports" description="Completions by person — on-time, early, and redemption quests">
      <ChoresReportsClient />
    </AppShell>
  );
}
