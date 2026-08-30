import { AppShell } from "../../../components/AppShell";
import { PageLoading } from "../../../components/PageLoading";
import { LinkButton } from "../../../components/ui";

// breadcrumb/actions must match page.tsx's shape, not just be "present in some form" — see the
// comment in app/drive/loading.tsx for the full explanation.
export default function Loading() {
  return (
    <AppShell
      title="Shopping reports"
      breadcrumb={[{ label: "Shopping", href: "/shopping" }, { label: "Reports" }]}
      actions={
        <LinkButton href="/shopping" variant="ghost" size="sm">
          Back to list
        </LinkButton>
      }
    >
      <PageLoading />
    </AppShell>
  );
}
