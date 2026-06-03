"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { ProfileOnboardingBanner } from "./ProfileOnboardingBanner";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/calendar", label: "Calendar" },
  { href: "/school", label: "School" },
  { href: "/shopping", label: "Shopping" },
  { href: "/chores", label: "Chores" },
  { href: "/notes", label: "Notes" },
  { href: "/expenses", label: "Expenses" },
];

export type ShellUser = {
  email: string;
  name: string | null;
  nickname: string | null;
  shownLabel: string | null;
};

function NavLink({ href, label, onClick }: { href: string; label: string; onClick?: () => void }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-2 text-sm transition",
        active
          ? "bg-[var(--color-accent)]/20 font-medium text-[var(--color-text)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]",
      )}
    >
      {label}
    </Link>
  );
}

export function AppChrome({
  user,
  children,
}: {
  user: ShellUser | null;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const label = user?.shownLabel ?? user?.name ?? user?.email?.split("@")[0] ?? "Account";

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 md:hidden"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link href="/dashboard" className="font-semibold tracking-tight">
              whome
            </Link>
          </div>

          <nav className="hidden flex-wrap items-center gap-1 md:flex">
            {nav.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </nav>

          <div className="relative" ref={userRef}>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-border)]/30"
              onClick={() => setUserOpen((v) => !v)}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent)]/30 text-xs font-medium">
                {label.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-[120px] truncate sm:inline">{label}</span>
            </button>
            {userOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-1 shadow-[var(--shadow-card)]">
                <p className="truncate px-3 py-2 text-xs text-[var(--color-text-muted)]">{user?.email}</p>
                <Link
                  href="/profile"
                  className="block px-3 py-2 text-sm hover:bg-[var(--color-border)]/40"
                  onClick={() => setUserOpen(false)}
                >
                  Profile
                </Link>
                <form action="/auth/logout" method="post">
                  <button
                    type="submit"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-border)]/40"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">Menu</span>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {nav.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  onClick={() => setMenuOpen(false)}
                />
              ))}
            </nav>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8">
        {user && <ProfileOnboardingBanner name={user.name} />}
        {children}
      </main>
    </div>
  );
}
