import { ModuleReportsLink } from "../../components/reports/ModuleReportsLink";
import { LoadingShell } from "../../components/LoadingShell";
import { PageLoading } from "../../components/PageLoading";

// `actions` here has to match page.tsx passing one too — see the comment in
// app/drive/loading.tsx for the full explanation (loading fallback and real page must render
// the same DOM shape or the streaming Suspense reveal silently never completes).
export default function Loading() {
  return (
    <LoadingShell title="Expenses" actions={<ModuleReportsLink module="expenses" />}>
      <PageLoading />
    </LoadingShell>
  );
}
