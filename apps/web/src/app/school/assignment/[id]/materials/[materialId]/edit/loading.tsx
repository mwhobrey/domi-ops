import { AppShell } from "../../../../../../../components/AppShell";
import { PageLoading } from "../../../../../../../components/PageLoading";

// Own loading.tsx rather than relying on inheritance from an ancestor — see the comment in
// app/chores/reports/loading.tsx for why (a Next.js App Router bug where nested-segment content
// can arrive from the server correctly but never get revealed client-side). This route is
// nested below ../../loading.tsx too, which isn't enough on its own — every leaf needs its own.
export default function Loading() {
  return (
    <AppShell title="Test">
      <PageLoading />
    </AppShell>
  );
}
