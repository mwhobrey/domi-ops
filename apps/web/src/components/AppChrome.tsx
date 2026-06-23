"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, LayoutGrid, Menu } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterVisibleNav } from "../lib/app-nav";
import { cn } from "../lib/cn";
import { authClient } from "../lib/auth-client";
import { NoticeBoardActions } from "./NoticeBoard";
import { Avatar } from "./ui/Avatar";
import { Drawer } from "./ui/Drawer";
import { IconButton } from "./ui/IconButton";
import { ProfileOnboardingBanner } from "./ProfileOnboardingBanner";

export type ShellUser = {
  email: string | null;
  username?: string | null;
  name: string | null;
  shownLabel: string | null;
  memberId: string;
  avatarUrl: string | null;
  role?: string;
};

function NavLink({
  href,
  label,
  icon: Icon,
  onClick,
  showLabel = "compact",
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  /** compact = icon-only (header bar); always = text + icon (drawers) */
  showLabel?: "compact" | "always";
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const iconOnly = showLabel === "compact";
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg py-2 text-sm transition",
        iconOnly ? "px-2.5" : "px-3",
        active
          ? "border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-subtle)] font-medium text-[var(--color-text)]"
          : "border-l-2 border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]",
        active && (iconOnly ? "pl-[calc(0.625rem-2px)]" : "pl-[calc(0.75rem-2px)]"),
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!iconOnly && <span>{label}</span>}
    </Link>
  );
}

export function AppChrome({
  user,
  modulesEnabled,
  children,
}: {
  user: ShellUser | null;
  modulesEnabled?: string[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  const userTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeUserMenu = useCallback(() => setUserOpen(false), []);
  const closeModulesDrawer = useCallback(() => setModulesOpen(false), []);

  const openMobileMenu = useCallback(() => {
    setModulesOpen(false);
    setUserOpen(false);
    setMenuOpen(true);
  }, []);

  const openModulesDrawer = useCallback(() => {
    setMenuOpen(false);
    setUserOpen(false);
    setModulesOpen(true);
  }, []);

  const handleNoticeOpenChange = useCallback((open: boolean) => {
    if (open) {
      setUserOpen(false);
      setModulesOpen(false);
      setMenuOpen(false);
    }
  }, []);

  async function onSignOut() {
    if (signOutPending) return;
    setUserOpen(false);
    setMenuOpen(false);
    setModulesOpen(false);
    setSignOutPending(true);
    try {
      const res = await authClient.signOut();
      if (res.error) {
        console.error("[whome] sign out failed:", res.error.message);
        return;
      }
      router.push("/login");
      router.refresh();
    } finally {
      setSignOutPending(false);
    }
  }

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

  const visibleNav = useMemo(
    () => filterVisibleNav(modulesEnabled),
    [modulesEnabled],
  );

  const label = user?.shownLabel ?? user?.name ?? user?.email?.split("@")[0] ?? "Account";
  const avatarId = user?.memberId ?? user?.email ?? "account";
  const canManageHousehold = user?.role === "owner" || user?.role === "admin";

  return (
    <div className="min-h-dvh bg-[var(--color-surface-inset)]">
      <header className="no-print sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="bg-page-gradient pointer-events-none absolute inset-0 opacity-30" aria-hidden />
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <IconButton
              className="lg:hidden"
              label="Open menu"
              onClick={openMobileMenu}
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

          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex" aria-label="Main">
            {visibleNav.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <IconButton
              className="hidden lg:inline-flex"
              label="All modules"
              aria-expanded={modulesOpen}
              onClick={() => (modulesOpen ? closeModulesDrawer() : openModulesDrawer())}
            >
              <LayoutGrid className="h-5 w-5" />
            </IconButton>

            {user && (
              <Suspense fallback={null}>
                <NoticeBoardActions
                  className="shrink-0"
                  onOpenChange={handleNoticeOpenChange}
                />
              </Suspense>
            )}

            <div className="relative" ref={userRef}>
              <button
                ref={userTriggerRef}
                type="button"
                aria-expanded={userOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-border)]/30"
                onClick={() => {
                  setModulesOpen(false);
                  setUserOpen((v) => !v);
                }}
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
                  <p className="truncate px-3 py-2 text-xs text-[var(--color-text-muted)]">
                    {user?.username ? `@${user.username}` : user?.email ?? "Signed in"}
                  </p>
                  <Link
                    href="/profile"
                    role="menuitem"
                    className="block px-3 py-2 text-sm hover:bg-[var(--color-border)]/40"
                    onClick={() => setUserOpen(false)}
                  >
                    Your profile
                  </Link>
                  {canManageHousehold && (
                    <Link
                      href="/settings"
                      role="menuitem"
                      className="block px-3 py-2 text-sm hover:bg-[var(--color-border)]/40"
                      onClick={() => setUserOpen(false)}
                    >
                      Household settings
                    </Link>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={signOutPending}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-border)]/40 disabled:opacity-60"
                    onClick={() => void onSignOut()}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
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
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    {user.username ? `@${user.username}` : user.email ?? "member"}
                  </p>
                </div>
              </div>
              <Link
                href="/profile"
                className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-border)]/40"
                onClick={() => setMenuOpen(false)}
              >
                Your profile
              </Link>
              {canManageHousehold && (
                <Link
                  href="/settings"
                  className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-border)]/40"
                  onClick={() => setMenuOpen(false)}
                >
                  Household settings
                </Link>
              )}
              <button
                type="button"
                disabled={signOutPending}
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-border)]/40 disabled:opacity-60"
                onClick={() => void onSignOut()}
              >
                Sign out
              </button>
            </div>
          ) : null
        }
      >
        <nav className="flex flex-col gap-1" aria-label="Main">
          {visibleNav.map((item) => (
            <NavLink key={item.href} {...item} showLabel="always" onClick={() => setMenuOpen(false)} />
          ))}
        </nav>
      </Drawer>

      <Drawer
        open={modulesOpen}
        onClose={closeModulesDrawer}
        title="All modules"
        visibility="desktop"
      >
        <nav className="flex flex-col gap-1" aria-label="All modules">
          {visibleNav.map((item) => (
            <NavLink
              key={item.href}
              {...item}
              showLabel="always"
              onClick={() => setModulesOpen(false)}
            />
          ))}
        </nav>
      </Drawer>

      <main className="mx-auto max-w-6xl px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {user && <ProfileOnboardingBanner name={user.name} />}
        {children}
      </main>
    </div>
  );
}
