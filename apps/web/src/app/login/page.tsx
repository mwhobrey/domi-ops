import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
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

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative w-full max-w-md space-y-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-8 shadow-[var(--shadow-card)]">
        <div className="space-y-2 text-center">
          <p className="text-label text-[var(--color-text-muted)]">Household operations</p>
          <h1 className="text-2xl font-semibold">Sign in to whome</h1>
        </div>
        {params.error === "oauth" && (
          <p className="rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 px-3 py-2 text-sm text-[var(--color-danger)]">
            Sign-in failed. Check OAuth redirect URIs and API logs, then try again.
          </p>
        )}
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          Owners sign up with email. Kids and other members get a username from Profile after you
          sign in. Google is optional for Calendar sync.
        </p>
        <LoginForm nextPath={nextPath} googleEnabled={googleEnabled} />
        <p className="text-center text-xs text-[var(--color-text-muted)]">
          <Link href="/" className="underline hover:text-[var(--color-text)]">
            Back to home
          </Link>
          {" · "}
          <Link href="/privacy" className="underline hover:text-[var(--color-text)]">
            Privacy
          </Link>
        </p>
      </div>
    </main>
  );
}
