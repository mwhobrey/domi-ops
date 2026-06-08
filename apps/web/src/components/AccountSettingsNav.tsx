"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/cn";

const links = [
  { href: "/profile", label: "Your profile" },
  { href: "/settings", label: "Household", adminOnly: true },
] as const;

export function AccountSettingsNav({ canManage }: { canManage: boolean }) {
  const pathname = usePathname();
  const visible = links.filter((link) => !("adminOnly" in link && link.adminOnly) || canManage);

  return (
    <nav
      aria-label="Account settings"
      className="mb-8 flex flex-wrap gap-1 border-b border-[var(--color-border)]"
    >
      {visible.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px rounded-t-[var(--radius-lg)] px-4 py-2.5 text-sm font-medium transition",
              active
                ? "border border-b-0 border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/30 hover:text-[var(--color-text)]",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
