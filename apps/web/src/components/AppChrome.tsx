"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Calendar,
  ClipboardList,
  Home,
  LayoutDashboard,
  Menu,
  NotebookPen,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Avatar } from "./ui/Avatar";
import { Drawer } from "./ui/Drawer";
import { IconButton } from "./ui/IconButton";
import { ProfileOnboardingBanner } from "./ProfileOnboardingBanner";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/school", label: "School", icon: BookOpen },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/chores", label: "Chores", icon: ClipboardList },
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/expenses", label: "Expenses", icon: Receipt },
];

export type ShellUser = {
  email: string;
  name: string | null;
  nickname: string | null;
  shownLabel: string | null;
  memberId: string;
  avatarUrl: string | null;
};

function NavLink({
  href,
  label,
  icon: Icon,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
        active
          ? "border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-subtle)] pl-[calc(0.75rem-2px)] font-medium text-[var(--color-text)]"
          : "border-l-2 border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="hidden xl:inline">{label}</span>
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
  const userTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeUserMenu = useCallback(() => setUserOpen(false), []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  useEffect(() => {
    if (!userOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeUserMenu();
        userTriggerRef.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const menu = menuRef.current;
        if (!menu) return;
        const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        const idx = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        const next =
          e.key === "ArrowDown"
            ? items[(idx + 1) % items.length]
            : items[(idx - 1 + items.length) % items.length];
        next?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [userOpen, closeUserMenu]);

  const label = user?.shownLabel ?? user?.name ?? user?.email?.split("@")[0] ?? "Account";
  const avatarId = user?.memberId ?? user?.email ?? "account";

  return (
    <div className="min-h-dvh bg-[var(--color-surface-inset)]">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/95 backdrop-blur">
        <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-30" aria-hidden />
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <IconButton
              className="md:hidden"
              label="Open menu"
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </IconButton>
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 font-display text-base font-semibold tracking-tight"
            >
              <Home className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
              whome
            </Link>
          </div>

          <nav className="hidden flex-wrap items-center gap-0.5 md:flex" aria-label="Main">
            {nav.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>

          <div className="relative" ref={userRef}>
            <button
              ref={userTriggerRef}
              type="button"
              aria-expanded={userOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-border)]/30"
              onClick={() => setUserOpen((v) => !v)}
            >
              <Avatar id={avatarId} name={label} src={user?.avatarUrl} size="sm" />
              <span className="hidden max-w-[120px] truncate sm:inline">{label}</span>
            </button>
            {userOpen && (
              <div
                ref={menuRef}
                role="menu"
                className="absolute right-0 mt-2 w-48 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-1 shadow-[var(--shadow-elevated)]"
              >
                <p className="truncate px-3 py-2 text-xs text-[var(--color-text-muted)]">{user?.email}</p>
                <Link
                  href="/profile"
                  role="menuitem"
                  className="block px-3 py-2 text-sm hover:bg-[var(--color-border)]/40"
                  onClick={() => setUserOpen(false)}
                >
                  Profile
                </Link>
                <form action="/auth/logout" method="post">
                  <button
                    type="submit"
                    role="menuitem"
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

      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Menu"
        footer={
          user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar id={avatarId} name={label} src={user?.avatarUrl} size="md" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{label}</p>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">{user.email}</p>
                </div>
              </div>
              <Link
                href="/profile"
                className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-border)]/40"
                onClick={() => setMenuOpen(false)}
              >
                Profile
              </Link>
              <form action="/auth/logout" method="post">
                <button
                  type="submit"
                  className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-border)]/40"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : null
        }
      >
        <nav className="flex flex-col gap-1" aria-label="Main">
          {nav.map((item) => (
            <NavLink key={item.href} {...item} onClick={() => setMenuOpen(false)} />
          ))}
        </nav>
      </Drawer>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {user && <ProfileOnboardingBanner name={user.name} />}
        {children}
      </main>
    </div>
  );
}
