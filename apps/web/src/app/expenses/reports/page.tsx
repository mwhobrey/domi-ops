import { AppShell } from "../../../components/AppShell";
import { ExpenseReportsClient } from "../../../components/ExpenseReportsClient";
import { LinkButton } from "../../../components/ui";

export default function ExpenseReportsPage() {
  return (
    <AppShell
      title="Spending reports"
      description="See where your money went and how you're tracking against targets"
      breadcrumb={[
        { label: "Expenses", href: "/expenses" },
        { label: "Reports" },
      ]}
      actions={
        <LinkButton href="/expenses" variant="ghost" size="sm">
          Back to list
        </LinkButton>
      }
    >
      <ExpenseReportsClient />
    </AppShell>
  );
}
