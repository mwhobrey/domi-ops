"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";
import { Button } from "../../components/ui";

type Mode = "sign-in" | "sign-up";
type SignInMethod = "email" | "username";

export function LoginForm({
  nextPath,
  googleEnabled,
  allowPublicSignup = false,
}: {
  nextPath: string;
  googleEnabled: boolean;
  allowPublicSignup?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [signInMethod, setSignInMethod] = useState<SignInMethod>("email");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      if (mode === "sign-up") {
        const res = await authClient.signUp.email({
          name: name.trim() || email.split("@")[0] || "Member",
          email: email.trim(),
          password,
          username: username.trim() || undefined,
          callbackURL: nextPath,
        });
        if (res.error) {
          setError(res.error.message ?? "Sign up failed");
          return;
        }
        if (res.data?.user && !res.data.user.emailVerified) {
          setInfo("Account created. Check your email for a verification link, then sign in.");
          setMode("sign-in");
          return;
        }
      } else if (signInMethod === "username") {
        const res = await authClient.signIn.username({
          username: username.trim(),
          password,
          callbackURL: nextPath,
        });
        if (res.error) {
          setError(res.error.message ?? "Sign in failed");
          return;
        }
      } else {
        const res = await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL: nextPath,
        });
        if (res.error) {
          const msg = res.error.message ?? "Sign in failed";
          setError(
            msg.toLowerCase().includes("verif")
              ? "Verify your email before signing in. Check your inbox for the verification link."
              : msg,
          );
          return;
        }
      }
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      if (msg?.includes("NetworkError") || msg?.includes("Failed to fetch")) {
        setError(
          "Could not reach the sign-in service. Use the same host as your browser tab (e.g. http://localhost:3000, not 127.0.0.1) and confirm the API is running.",
        );
        return;
      }
      setError(msg?.trim() ? msg : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function onGoogle() {
    setError(null);
    setPending(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: nextPath,
      });
    } catch {
      setError(
        "Google sign-in failed. Open the app at the same host as PUBLIC_APP_URL (e.g. http://localhost:3000, not 127.0.0.1) and confirm OAuth redirect URIs.",
      );
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

      {info && (
        <p
          className="rounded-[var(--radius-lg)] border border-[var(--color-success-muted)] bg-[var(--color-success-muted)]/20 px-3 py-2 text-sm text-[var(--color-success)]"
          role="status"
        >
          {info}
        </p>
      )}

      {mode === "sign-in" && (
        <div
          className="flex rounded-[var(--radius-lg)] border border-[var(--color-border)] p-1 text-sm"
          role="tablist"
          aria-label="Sign-in method"
        >
          {(["email", "username"] as const).map((method) => (
            <button
              key={method}
              type="button"
              role="tab"
              aria-selected={signInMethod === method}
              className={`min-h-11 flex-1 rounded-[var(--radius-md)] px-3 py-2 font-medium transition-colors ${
                signInMethod === method
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
              onClick={() => setSignInMethod(method)}
            >
              {method === "email" ? "Email" : "Username"}
            </button>
          ))}
        </div>
      )}

      <form className="space-y-4" onSubmit={onSubmit}>
        {mode === "sign-up" && (
          <>
            <label className="block space-y-1.5">
              <span className="text-label text-[var(--color-text-muted)]">Name</span>
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
              <span className="text-label text-[var(--color-text-muted)]">
                Username <span className="font-normal">(optional)</span>
              </span>
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              />
            </label>
          </>
        )}

        {mode === "sign-in" && signInMethod === "username" ? (
          <label className="block space-y-1.5">
            <span className="text-label text-[var(--color-text-muted)]">Username</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            />
          </label>
        ) : (
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
        )}

        <label className="block space-y-1.5">
          <span className="text-label text-[var(--color-text-muted)]">Password</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        </label>

        <Button type="submit" className="w-full" disabled={pending}>
          {pending
            ? "Please wait…"
            : mode === "sign-up"
              ? "Create household account"
              : signInMethod === "username"
                ? "Sign in with username"
                : "Sign in with email"}
        </Button>
      </form>

      {mode === "sign-in" && signInMethod === "username" && (
        <p className="text-center text-xs text-[var(--color-text-muted)]">
          Username accounts are created by a household parent under Household settings.
        </p>
      )}

      {allowPublicSignup && (
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          {mode === "sign-in" ? (
            <>
              First household on this server?{" "}
              <button
                type="button"
                className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
                onClick={() => setMode("sign-up")}
              >
                Create owner account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
                onClick={() => setMode("sign-in")}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      )}

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
            disabled={pending}
            onClick={onGoogle}
          >
            Continue with Google
          </Button>
        </>
      )}
    </div>
  );
}
