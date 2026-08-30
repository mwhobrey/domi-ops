import { LoadingShell } from "../../../components/LoadingShell";
import { PageLoading } from "../../../components/PageLoading";

// DIAGNOSTIC (2026-08-30): breadcrumb/actions temporarily removed to match page.tsx's
// diagnostic version — see the comment there.
export default function Loading() {
  return (
    <LoadingShell title="Chore reports">
      <PageLoading />
    </LoadingShell>
  );
}
