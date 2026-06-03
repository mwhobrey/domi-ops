import { AppShell } from "../../components/AppShell";
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
      <div className="grid gap-4 sm:grid-cols-2">
        {classes.length === 0 ? (
          <p className="text-[var(--color-text-muted)]">No classes yet. Create one via API or import from HomeHub.</p>
        ) : (
          classes.map((c) => (
            <article
              key={c.id}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5"
            >
              <h2 className="font-medium">{c.name}</h2>
              {c.subject && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{c.subject}</p>}
              {c.term && <p className="text-xs text-[var(--color-text-muted)]">{c.term}</p>}
            </article>
          ))
        )}
      </div>
    </AppShell>
  );
}
