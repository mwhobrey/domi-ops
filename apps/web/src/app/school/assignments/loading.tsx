import { AppShell } from "../../../components/AppShell";
import { PageLoading } from "../../../components/PageLoading";

// breadcrumb must match page.tsx's shape, not just be "present in some form" — see the comment
// in app/drive/loading.tsx for the full explanation. Real second label depends on a searchParams
// filter (due/overdue) not available here; the placeholder just needs to be a same-shaped item.
export default function Loading() {
  return (
    <AppShell
      title="Assignments"
      breadcrumb={[{ label: "School", href: "/school" }, { label: "Assignments" }]}
    >
      <PageLoading />
    </AppShell>
  );
}
