import { AppShell } from "../../components/AppShell";
import { SchoolClassList } from "../../components/SchoolClassList";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

interface SchoolClass {
  id: string;
  name: string;
  subject: string | null;
  term: string | null;
}

export default async function SchoolPage() {
  let classes: SchoolClass[] = [];
  let loadError: string | null = null;
  try {
    const res = await apiFetch<{ classes: SchoolClass[] }>("/api/school/classes");
    classes = res.classes;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load school";
  }

  return (
    <AppShell
      title="School"
      description="Homeschool LMS — classes, assignments, submissions, and grades"
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/school">Retry</a>
        </Alert>
      ) : (
        <SchoolClassList initialClasses={classes} />
      )}
    </AppShell>
  );
}
