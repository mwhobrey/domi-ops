import { AppShell } from "../../../../components/AppShell";
import { PageLoading } from "../../../../components/PageLoading";

// breadcrumb must match page.tsx's shape (same item count and href presence — a middle item's
// href decides whether Breadcrumb renders a <Link> or a <span>, so it isn't just cosmetic), not
// just "present in some form" — see the comment in app/drive/loading.tsx for the full
// explanation. Real class/assignment names are fetched server-side — not known yet here, so
// these are placeholder items of the same shape, not the same text.
export default function Loading() {
  return (
    <AppShell
      title="Assignment"
      breadcrumb={[
        { label: "School", href: "/school" },
        { label: "Class", href: "/school" },
        { label: "Assignment" },
      ]}
    >
      <PageLoading />
    </AppShell>
  );
}
