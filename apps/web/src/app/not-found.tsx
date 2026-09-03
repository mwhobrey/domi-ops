import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative w-full max-w-[26rem] space-y-5 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 text-center shadow-[var(--shadow-card)] sm:p-8">
        <p className="font-display text-3xl font-semibold tracking-tight">Domi Ops</p>
        <h1 className="text-base font-medium text-[var(--color-text-muted)]">
          That page doesn&apos;t exist
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          The link may be broken or the page may have moved.
        </p>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-accent)] px-4 text-sm font-medium text-[var(--color-accent-fg)]"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
