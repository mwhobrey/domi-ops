import { AppShell } from "../../../components/AppShell";
import { PageLoading } from "../../../components/PageLoading";
import { LinkButton } from "../../../components/ui";

// breadcrumb/actions must match page.tsx's shape, not just be "present in some form" — see the
// comment in app/drive/loading.tsx for the full explanation.
export default function Loading() {
  return (
    <AppShell
      title="Health reports"
      breadcrumb={[{ label: "Health", href: "/health" }, { label: "Reports" }]}
      actions={
        <span className="no-print">
          <LinkButton href="/health" variant="ghost" size="sm">
            Back to health
          </LinkButton>
        </span>
      }
    >
      <PageLoading />
    </AppShell>
  );
}
