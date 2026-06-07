import { AppShell } from "../../../components/AppShell";
import { ShoppingReportsClient } from "../../../components/ShoppingReportsClient";
import { LinkButton } from "../../../components/ui";

export default function ShoppingReportsPage() {
  return (
    <AppShell
      title="Shopping reports"
      description="Groceries purchased and spend over time"
      breadcrumb={[
        { label: "Shopping", href: "/shopping" },
        { label: "Reports" },
      ]}
      actions={
        <LinkButton href="/shopping" variant="ghost" size="sm">
          Back to list
        </LinkButton>
      }
    >
      <ShoppingReportsClient />
    </AppShell>
  );
}
