"use client";

import { useState } from "react";
import { authClient } from "../../lib/auth-client";
import { Button } from "../../components/ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
      });
      if (res.error) {
        setError(res.error.message ?? "Something went wrong. Try again.");
        return;
      }
      // Better Auth reports success even for an unknown email (timing-attack mitigation) —
      // show the same message either way, matching that intent.
      setSent(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      setError(msg?.trim() ? msg : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <p
        className="rounded-[var(--radius-lg)] border border-[var(--color-success-muted)] bg-[var(--color-success-muted)]/20 px-3 py-2.5 text-sm leading-relaxed text-[var(--color-success)]"
        role="status"
      >
        If that email has an account, a reset link is on its way. Check your inbox — the link
        expires in 1 hour.
      </p>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {error && (
        <p
          className="rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 px-3 py-2 text-sm text-[var(--color-danger)]"
          role="alert"
        >
          {error}
        </p>
      )}

      <label className="block space-y-1.5">
        <span className="text-label text-[var(--color-text-muted)]">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        />
      </label>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Please wait…" : "Send reset link"}
      </Button>
    </form>
  );
}
