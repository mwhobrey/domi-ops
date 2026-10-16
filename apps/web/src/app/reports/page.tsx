import { Suspense } from "react";
import { AppShell } from "../../components/AppShell";
import { ReportsHubClient } from "../../components/reports/ReportsHubClient";
import { ContentSkeleton } from "../../components/ContentSkeleton";

export default function ReportsPage() {
  return (
    <AppShell title="Reports">
      <Suspense
        fallback={
          <ContentSkeleton variant="report" label="Loading reports" />
        }
      >
        <ReportsHubClient />
      </Suspense>
    </AppShell>
  );
}
