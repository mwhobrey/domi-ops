import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative w-full max-w-[26rem] space-y-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <header className="space-y-1 text-center">
          <p className="font-display text-3xl font-semibold tracking-tight">Domi Ops</p>
          <h1 className="text-base font-medium text-[var(--color-text-muted)]">
            Reset your password
          </h1>
        </header>

        <p className="text-center text-sm text-[var(--color-text-muted)]">
          Enter the email on your account and we&apos;ll send you a link to set a new password.
        </p>

        <ForgotPasswordForm />

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
