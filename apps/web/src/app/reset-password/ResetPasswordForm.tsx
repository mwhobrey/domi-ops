"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";
import { Button } from "../../components/ui";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This reset link is missing its token. Request a new one.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    try {
      const res = await authClient.resetPassword({ newPassword: password, token });
      if (res.error) {
        const msg = res.error.message ?? "";
        setError(
          msg.toLowerCase().includes("token")
            ? "This reset link is invalid or has expired. Request a new one."
            : msg || "Something went wrong. Try again.",
        );
        return;
      }
      router.push("/login?reset=1");
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      setError(msg?.trim() ? msg : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
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
        <span className="text-label text-[var(--color-text-muted)]">New password</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-label text-[var(--color-text-muted)]">Confirm password</span>
        <input
          type="password"
          name="confirm"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        />
      </label>

      <Button type="submit" className="w-full" disabled={pending || !token}>
        {pending ? "Please wait…" : "Set new password"}
      </Button>
    </form>
  );
}
