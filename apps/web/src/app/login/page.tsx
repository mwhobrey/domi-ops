import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { googleLoginUrl } from "../../lib/api";

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
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-8">
        <h1 className="text-2xl font-semibold">Sign in to whome</h1>
        {params.error === "oauth" && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Sign-in failed. Check API logs and Google OAuth redirect URIs, then try again.
          </p>
        )}
        <p className="text-sm text-[var(--color-text-muted)]">
          Use your Google account. Calendar permissions are requested separately when you connect sync.
        </p>
        <a
          href={googleLoginUrl()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-3 font-medium text-white hover:bg-[var(--color-accent-muted)]"
        >
          Continue with Google
        </a>
        <p className="text-center text-xs text-[var(--color-text-muted)]">
          <Link href="/" className="underline">
            Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
