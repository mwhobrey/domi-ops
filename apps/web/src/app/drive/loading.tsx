import { LoadingShell } from "../../components/LoadingShell";
import { PageLoading } from "../../components/PageLoading";

// `breadcrumb` here has to match page.tsx passing one too, even though the loading state can't
// know the real content yet. Root cause (found 2026-08-30): AppShell conditionally renders
// <Breadcrumb> and an actions wrapper only when those props are given
// (apps/web/src/components/AppShell.tsx, PageHeader.tsx) — when the loading.tsx fallback and
// the real page pass a *different* set of these props, their rendered DOM shapes differ, and on
// a fresh page load the React streaming-SSR Suspense reveal (the inline `$RC(...)` script that's
// supposed to swap the fallback out for the real content) silently never takes effect — the
// server sends fully correct HTML, it just never becomes visible, with zero console or server
// errors either side. Every affected page in this app had a loading.tsx that passed only
// `title`, while its own page.tsx also passed `breadcrumb` and/or `actions` — 20+ pages
// surveyed, the correlation was exact. The fix is keeping the fallback's shape (which props are
// present, not their exact content) identical to the real page's.
export default function DriveLoading() {
  return (
    <LoadingShell title="Drive" breadcrumb={[{ label: "Drive" }]}>
      <PageLoading />
    </LoadingShell>
  );
}
