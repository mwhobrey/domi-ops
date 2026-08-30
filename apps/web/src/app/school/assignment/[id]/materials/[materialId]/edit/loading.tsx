import { AppShell } from "../../../../../../../components/AppShell";
import { PageLoading } from "../../../../../../../components/PageLoading";

// breadcrumb must match page.tsx's shape (same item count and href presence), not just
// "present in some form" — see the comment in app/drive/loading.tsx for the full explanation.
export default function Loading() {
  return (
    <AppShell
      title="Test"
      breadcrumb={[
        { label: "School", href: "/school" },
        { label: "Class", href: "/school" },
        { label: "Assignment", href: "/school" },
        { label: "Edit test" },
      ]}
    >
      <PageLoading />
    </AppShell>
  );
}
