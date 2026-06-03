import { AppShell } from "../../components/AppShell";
import { SchoolClassList } from "../../components/SchoolClassList";
import { apiFetch } from "../../lib/api";

interface SchoolClass {
  id: string;
  name: string;
  subject: string | null;
  term: string | null;
}

export default async function SchoolPage() {
  let classes: SchoolClass[] = [];
  try {
    const res = await apiFetch<{ classes: SchoolClass[] }>("/api/school/classes");
    classes = res.classes;
  } catch {
    /* */
  }

  return (
    <AppShell title="School">
      <p className="mb-6 text-sm text-[var(--color-text-muted)]">
        Homeschool LMS — classes, assignments, submissions, and gradebook basics.
      </p>
      <SchoolClassList initialClasses={classes} />
    </AppShell>
  );
}
