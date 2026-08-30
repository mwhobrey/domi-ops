import { AppShell } from "../../../components/AppShell";
import { PageLoading } from "../../../components/PageLoading";

// breadcrumb must match page.tsx's shape, not just be "present in some form" — see the comment
// in app/drive/loading.tsx for the full explanation.
export default function Loading() {
  return (
    <AppShell
      title="Grade reports"
      breadcrumb={[{ label: "School", href: "/school" }, { label: "Reports" }]}
    >
      <PageLoading />
    </AppShell>
  );
}
