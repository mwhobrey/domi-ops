export const dynamic = "force-dynamic";

import { AppShell } from "../../../components/AppShell";
import { SchoolRecordsClient } from "../../../components/SchoolRecordsClient";
import { apiFetch } from "../../../lib/api";
import { loadErrorMessage } from "../../../lib/load-error";
import type { RecordStudent } from "../../../lib/school-records";
import { Alert } from "../../../components/ui";

export default async function SchoolRecordsPage() {
  let students: RecordStudent[] = [];
  let loadError: string | null = null;

  try {
    students = (await apiFetch<{ students: RecordStudent[] }>("/api/school/records/students")).students;
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load records");
  }

  return (
    <AppShell
      title="Records"
      description="Attendance, instruction hours, and transcripts"
      breadcrumb={[{ label: "School", href: "/school" }, { label: "Records" }]}
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/school/records">Retry</a>
        </Alert>
      ) : (
        <SchoolRecordsClient students={students} />
      )}
    </AppShell>
  );
}
