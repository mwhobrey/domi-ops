import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AnchorButton } from "../../components/ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
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
        redirect(params.next?.startsWith("/") ? params.next : "/dashboard");
      }
    }
  } catch {
    /* API not up */
  }

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
            Sign-in failed. Check Google OAuth redirect URIs and API logs, then try again.
          </p>
        )}
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          Use your household Google account. Each family member signs in once, then sets name and
          nickname on Profile.
        </p>
        <AnchorButton
          href={
            params.next?.startsWith("/")
              ? `/auth/google/login?next=${encodeURIComponent(params.next)}`
              : "/auth/google/login"
          }
          className="flex w-full"
        >
          Continue with Google
        </AnchorButton>
        <p className="text-center text-xs text-[var(--color-text-muted)]">
          <Link href="/" className="underline hover:text-[var(--color-text)]">
            Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
