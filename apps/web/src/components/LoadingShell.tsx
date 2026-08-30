import { AppChrome } from "./AppChrome";
import { Breadcrumb, type BreadcrumbItem, PageHeader } from "./ui";

/**
 * Loading-only counterpart to AppShell — same visual shell, but a plain synchronous component
 * with zero async work of its own (no `cookies()`, no `/auth/session` fetch), unlike AppShell
 * (an `async function` that fetches the session server-side). Root cause under investigation
 * (2026-08-30): every `loading.tsx` in this app rendered `<AppShell>` — the same async
 * component page.tsx also renders — and on a fresh page load the real content would arrive
 * from the server (confirmed via direct fetch: fully correct HTML, including the `$RC(...)`
 * script meant to reveal it) but never visibly replace the loading fallback. Neither giving each
 * route its own loading.tsx nor matching the fallback's breadcrumb/actions shape to the real
 * page fixed it; the one remaining structural difference is that `AppShell` gets invoked twice
 * per request (once by loading.tsx, once by page.tsx) when a loading.tsx uses it — this
 * component exists to test whether that's the actual trigger, by never invoking it at all
 * from a loading state.
 */
export function LoadingShell({
  children,
  title,
  breadcrumb,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: React.ReactNode;
}) {
  return (
    <AppChrome user={null}>
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <PageHeader title={title} actions={actions} />
      {children}
    </AppChrome>
  );
}
