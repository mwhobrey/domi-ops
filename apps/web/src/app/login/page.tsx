import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isPublicSignupAllowed } from "../../lib/allow-public-signup";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; hosted?: string }>;
}) {
  const params = await searchParams;
  const nextPath = params.next?.startsWith("/") ? params.next : "/dashboard";
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  try {
    const sessionBase = process.env.API_URL ?? "http://localhost:4000";
    const res = await fetch(`${sessionBase}/auth/session`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { authenticated?: boolean };
      if (data.authenticated) {
        redirect(nextPath);
      }
    }
  } catch {
    /* API not up */
  }

  const googleEnabled = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );

  const allowPublicSignup = isPublicSignupAllowed();
  const isDemoMode = process.env.DEMO_MODE === "true" || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const demoEmail = process.env.DEMO_OWNER_EMAIL ?? "demo@domi-ops.com";
  const demoPassword = process.env.DEMO_OWNER_PASSWORD ?? "DemoRivera2026!";

  let needsSetup = false;
  try {
    const sessionBase = process.env.API_URL ?? "http://localhost:4000";
    const setupRes = await fetch(`${sessionBase}/api/core/setup/status`, { cache: "no-store" });
    if (setupRes.ok) {
      const data = (await setupRes.json()) as { needsSetup?: boolean };
      needsSetup = Boolean(data.needsSetup);
    }
  } catch {
    /* API not up */
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative w-full max-w-[26rem] space-y-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <header className="space-y-1 text-center">
          <img src="/icon.svg" alt="" width={40} height={40} className="mx-auto h-10 w-10" aria-hidden />
          <p className="font-display text-3xl font-semibold tracking-tight">Domi Ops</p>
          <h1 className="text-base font-medium text-[var(--color-text-muted)]">Sign in</h1>
        </header>

        {params.hosted === "1" && (
          <p
            className="rounded-[var(--radius-lg)] border border-[var(--color-accent)]/40 bg-[var(--color-accent-subtle)] px-3 py-2.5 text-sm leading-relaxed text-[var(--color-text)]"
            role="status"
          >
            Your household is ready — sign in with the email and password you just set.
          </p>
        )}

        {params.error === "oauth" && (
          <p
            className="rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 px-3 py-2.5 text-sm text-[var(--color-danger)]"
            role="alert"
          >
            Sign-in failed. Check OAuth redirect URIs and API logs, then try again.
          </p>
        )}

        {!allowPublicSignup && !isDemoMode && needsSetup && (
          <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm leading-relaxed text-[var(--color-text-muted)]">
            First household on this server?{" "}
            <Link href="/setup" className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline">
              Run setup
            </Link>{" "}
            with your <code className="font-mono text-xs">SETUP_TOKEN</code>.
          </p>
        )}

        {!allowPublicSignup && !isDemoMode && !needsSetup && (
          <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm leading-relaxed text-[var(--color-text-muted)]">
            New here? Ask your household owner to invite you by email or Google, or to set you up
            with a username from Household settings.
          </p>
        )}

        {isDemoMode && (
          <p
            className="rounded-[var(--radius-lg)] border border-[var(--color-accent)]/40 bg-[var(--color-accent-subtle)] px-3 py-2.5 text-sm leading-relaxed text-[var(--color-text)]"
            role="status"
          >
            <strong className="font-medium">Demo login</strong>
            <span className="block mt-1 font-mono text-xs text-[var(--color-text-muted)]">
              {demoEmail}
              <br />
              {demoPassword}
            </span>
          </p>
        )}

        <LoginForm
          nextPath={nextPath}
          googleEnabled={googleEnabled}
          allowPublicSignup={allowPublicSignup}
        />

        <p className="text-center text-xs text-[var(--color-text-muted)]">
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-[var(--color-text)]"
          >
            Privacy
          </Link>
          {" · "}
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-[var(--color-text)]"
          >
            Terms
          </Link>
        </p>
      </div>
    </main>
  );
}
