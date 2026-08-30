import { AppShell } from "../../../components/AppShell";
import { PageLoading } from "../../../components/PageLoading";

// Own loading.tsx, not just inherited from ../loading.tsx — Next.js App Router has a known bug
// (github.com/vercel/next.js issues #67923, #69625, #73474, #86151 — this app's own repro was a
// deeper, hard-reload-specific case not exactly matching any single one) where a streamed page
// nested one or more segments below the ancestor that owns the Suspense boundary can arrive
// from the server fully correct but never get revealed client-side: it sits in a `hidden`
// placeholder div forever, with zero console or server errors. The one page AT the same segment
// as loading.tsx (e.g. /chores itself) is unaffected; every nested child (e.g. /chores/reports)
// was — confirmed 2026-08-30 across every affected segment in this app, not something specific
// to this route. Giving each nested leaf its own loading.tsx (this file) gives it its own
// boundary instead of an inherited one, which fixes it.
export default function Loading() {
  return (
    <AppShell title="Chore reports">
      <PageLoading />
    </AppShell>
  );
}
