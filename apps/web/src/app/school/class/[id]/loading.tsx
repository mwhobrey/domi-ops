import { AppShell } from "../../../../components/AppShell";
import { PageLoading } from "../../../../components/PageLoading";

// breadcrumb must match page.tsx's shape (same item count), not just be "present in some
// form" — see the comment in app/drive/loading.tsx for the full explanation. The real second
// label is the class name, fetched server-side — not known yet here, so this is a placeholder
// item of the same shape, not the same text.
export default function Loading() {
  return (
    <AppShell
      title="Class"
      breadcrumb={[{ label: "School", href: "/school" }, { label: "Class", href: "/school" }]}
    >
      <PageLoading />
    </AppShell>
  );
}
