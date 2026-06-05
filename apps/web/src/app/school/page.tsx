import { AppShell } from "../../components/AppShell";
import { SchoolClassList } from "../../components/SchoolClassList";
import { apiFetch } from "../../lib/api";
import type { SchoolContext } from "../../lib/school-access";
import { Alert } from "../../components/ui";

interface SchoolClass {
  id: string;
  name: string;
  subject: string | null;
  term: string | null;
  myEnrollmentRole?: string | null;
}

export default async function SchoolPage() {
  let classes: SchoolClass[] = [];
  let glance = { classCount: 0, dueSoon: 0, overdue: 0 };
  let context: SchoolContext | null = null;
  let loadError: string | null = null;
  try {
    const [classRes, glanceRes] = await Promise.all([
      apiFetch<{ classes: SchoolClass[]; context: SchoolContext }>("/api/school/classes"),
      apiFetch<{
        classCount: number;
        dueSoon: number;
        overdue: number;
        enabled?: boolean;
        context?: SchoolContext | null;
      }>("/api/school/glance"),
    ]);
    classes = classRes.classes;
    context = classRes.context;
    if (glanceRes.enabled !== false) {
      glance = {
        classCount: glanceRes.classCount,
        dueSoon: glanceRes.dueSoon,
        overdue: glanceRes.overdue,
      };
      if (!context && glanceRes.context) context = glanceRes.context;
    }
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load school";
  }

  return (
    <AppShell
      title="School"
      description={
        context?.viewMode === "student"
          ? "Your classes, assignments, and grades"
          : "Homeschool LMS — classes, assignments, submissions, and grades"
      }
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/school">Retry</a>
        </Alert>
      ) : (
        <SchoolClassList initialClasses={classes} glance={glance} context={context} />
      )}
    </AppShell>
  );
}
