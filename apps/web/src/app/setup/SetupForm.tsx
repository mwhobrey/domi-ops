"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";
import { Button } from "../../components/ui";

export function SetupForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function unlockToken(): Promise<boolean> {
    const res = await fetch("/api/core/setup/unlock", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(data.message ?? "Invalid setup token");
    }
    return true;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await unlockToken();
      const res = await authClient.signUp.email({
        name: name.trim() || email.split("@")[0] || "Owner",
        email: email.trim(),
        password,
        callbackURL: "/dashboard",
      });
      if (res.error) {
        setError(res.error.message ?? "Could not create owner account");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setPending(false);
    }
  }

  async function onGoogle() {
    setError(null);
    setPending(true);
    try {
      await unlockToken();
      const res = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/dashboard",
      });
      if (res.error) {
        setError(res.error.message ?? "Google setup failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google setup failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          className="rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 px-3 py-2 text-sm text-[var(--color-danger)]"
          role="alert"
        >
          {error}
        </p>
      )}

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block space-y-1.5">
          <span className="text-label text-[var(--color-text-muted)]">Setup token</span>
          <input
            type="password"
            name="setup-token"
            autoComplete="off"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
          <span className="block text-xs text-[var(--color-text-muted)]">
            Copy from <code className="font-mono">SETUP_TOKEN</code> in your server <code className="font-mono">.env</code>.
          </span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-label text-[var(--color-text-muted)]">Your name</span>
          <input
            type="text"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-label text-[var(--color-text-muted)]">Owner email</span>
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

        <label className="block space-y-1.5">
          <span className="text-label text-[var(--color-text-muted)]">Password</span>
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

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating household…" : "Create owner account"}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden />
            or
            <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={pending || !token.trim()}
            onClick={() => void onGoogle()}
          >
            Continue with Google
          </Button>
        </>
      )}
    </div>
  );
}
