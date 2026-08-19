import Link from "next/link";
import { redirect } from "next/navigation";
import { SetupForm } from "./SetupForm";
import { HostedSetupForm } from "./HostedSetupForm";

type SetupStatus = {
  needsSetup: boolean;
  setupTokenConfigured: boolean;
  allowPublicSignup: boolean;
  demoMode: boolean;
};

async function fetchSetupStatus(): Promise<SetupStatus | null> {
  try {
    const apiBase = process.env.API_URL ?? "http://localhost:4000";
    const res = await fetch(`${apiBase}/api/core/setup/status`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as SetupStatus;
  } catch {
    return null;
  }
}

type ValidateResult =
  | { valid: true; householdId: string; email: string; householdName: string }
  | { valid: false; reason: string };

async function fetchValidate(sessionId: string): Promise<ValidateResult> {
  try {
    const apiBase = process.env.API_URL ?? "http://localhost:4000";
    const res = await fetch(
      `${apiBase}/api/billing/hosted-setup/validate?session_id=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" },
    );
    return (await res.json()) as ValidateResult;
  } catch {
    return { valid: false, reason: "error" };
  }
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; session_id?: string }>;
}) {
  const params = await searchParams;

  // Hosted post-checkout path
  if (params.session_id) {
    const validated = await fetchValidate(params.session_id);

    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative w-full max-w-[26rem] space-y-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 shadow-[var(--shadow-card)] sm:p-8">
          <header className="space-y-1 text-center">
            <p className="font-display text-3xl font-semibold tracking-tight">Domi Ops</p>
            <h1 className="text-base font-medium text-[var(--color-text-muted)]">Set up your household</h1>
          </header>

          <HostedSetupForm sessionId={params.session_id} initialData={validated} />

          <p className="text-center text-sm text-[var(--color-text-muted)]">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    );
  }

  // Self-host setup path
  const status = await fetchSetupStatus();

  if (status && !status.needsSetup) {
    redirect("/login");
  }

  const googleEnabled = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative w-full max-w-[26rem] space-y-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <header className="space-y-1 text-center">
          <p className="font-display text-3xl font-semibold tracking-tight">Domi Ops</p>
          <h1 className="text-base font-medium text-[var(--color-text-muted)]">First-time setup</h1>
        </header>

        {params.error === "token" && (
          <p className="rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 px-3 py-2.5 text-sm text-[var(--color-danger)]" role="alert">
            Google sign-in requires a valid setup token. Enter your token below, then try again.
          </p>
        )}

        {status && !status.setupTokenConfigured && (
          <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm leading-relaxed text-[var(--color-text-muted)]">
            This server has no <code className="font-mono text-xs">SETUP_TOKEN</code> configured. Set one in{" "}
            <code className="font-mono text-xs">.env</code> (min 16 characters) and restart the API, or run{" "}
            <code className="font-mono text-xs">npm run bootstrap:owner</code> on the server.
          </p>
        )}

        {status?.setupTokenConfigured ? (
          <SetupForm googleEnabled={googleEnabled} />
        ) : null}

        <p className="text-center text-sm text-[var(--color-text-muted)]">
          Already set up?{" "}
          <Link href="/login" className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
