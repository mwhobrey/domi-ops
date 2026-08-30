import { AppShell } from "../../../components/AppShell";
import { PageLoading } from "../../../components/PageLoading";

// Own loading.tsx rather than relying on inheritance from ../loading.tsx — see the comment in
// app/chores/reports/loading.tsx for why (a Next.js App Router bug where nested-segment content
// can arrive from the server correctly but never get revealed client-side).
export default function Loading() {
  return (
    <AppShell title="Medication manager">
      <PageLoading />
    </AppShell>
  );
}
