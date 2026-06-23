import { AppShell } from "../../../components/AppShell";
import { HealthReportsClient } from "../../../components/HealthReportsClient";
import { LinkButton } from "../../../components/ui";

export default function HealthReportsPage() {
  return (
    <AppShell
      title="Health reports"
      description="Events, ongoing conditions, and medication adherence"
      breadcrumb={[
        { label: "Health", href: "/health" },
        { label: "Reports" },
      ]}
      actions={
        <span className="no-print">
          <LinkButton href="/health" variant="ghost" size="sm">
            Back to health
          </LinkButton>
        </span>
      }
    >
      <HealthReportsClient />
    </AppShell>
  );
}
