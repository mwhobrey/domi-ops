import { LoadingShell } from "../../../components/LoadingShell";
import { PageLoading } from "../../../components/PageLoading";
import { LinkButton } from "../../../components/ui";

// breadcrumb/actions must match page.tsx's shape, not just be "present in some form" — see the
// comment in app/drive/loading.tsx for the full explanation.
export default function Loading() {
  return (
    <LoadingShell
      title="Spending reports"
      breadcrumb={[{ label: "Expenses", href: "/expenses" }, { label: "Reports" }]}
      actions={
        <LinkButton href="/expenses" variant="ghost" size="sm">
          Back to list
        </LinkButton>
      }
    >
      <PageLoading />
    </LoadingShell>
  );
}
