import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? null;

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative w-full max-w-[26rem] space-y-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <header className="space-y-1 text-center">
          <p className="font-display text-3xl font-semibold tracking-tight">Domi Ops</p>
          <h1 className="text-base font-medium text-[var(--color-text-muted)]">
            Set a new password
          </h1>
        </header>

        {!token && (
          <p
            className="rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 px-3 py-2.5 text-sm text-[var(--color-danger)]"
            role="alert"
          >
            This link is missing its reset token.{" "}
            <Link href="/forgot-password" className="underline underline-offset-2">
              Request a new one
            </Link>
            .
          </p>
        )}

        <ResetPasswordForm token={token} />

        <p className="text-center text-sm text-[var(--color-text-muted)]">
          <Link
            href="/login"
            className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
