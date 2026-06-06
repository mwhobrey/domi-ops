import { Suspense } from "react";
import { AppShell } from "../../../components/AppShell";
import { SchoolReports } from "../../../components/SchoolReports";
import { apiFetch } from "../../../lib/api";
import { loadErrorMessage } from "../../../lib/load-error";
import type { SchoolReportsData } from "../../../lib/school-reports";
import { Alert } from "../../../components/ui";

export default async function SchoolReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string }>;
}) {
  const { term } = await searchParams;
  let reports: SchoolReportsData | null = null;
  let loadError: string | null = null;

  const query = term ? `?term=${encodeURIComponent(term)}` : "";

  try {
    reports = await apiFetch<SchoolReportsData>(`/api/school/reports${query}`);
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load grade reports");
  }

  return (
    <AppShell
      title="Grade reports"
      description="Household-wide grades — weighted averages, open work, progress, and transcripts"
      breadcrumb={[
        { label: "School", href: "/school" },
        { label: "Reports" },
      ]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/school/reports">Retry</a>
        </Alert>
      ) : reports ? (
        <Suspense fallback={null}>
          <SchoolReports reports={reports} />
        </Suspense>
      ) : null}
    </AppShell>
  );
}
