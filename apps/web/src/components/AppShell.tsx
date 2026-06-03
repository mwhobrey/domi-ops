import Link from "next/link";
import { apiFetch } from "../lib/api";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/calendar", label: "Calendar" },
  { href: "/school", label: "School" },
  { href: "/shopping", label: "Shopping" },
];

export function AppShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            whome
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

export async function SessionUser() {
  try {
    const session = await apiFetch<{
      authenticated: boolean;
      user?: { email: string };
    }>("/auth/session");
    if (session.authenticated && session.user) {
      return <span className="text-sm text-[var(--color-text-muted)]">{session.user.email}</span>;
    }
  } catch {
    return null;
  }
  return null;
}
