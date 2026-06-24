import Link from "next/link";
import type { ReactNode } from "react";
import { AnchorButton, LinkButton } from "./LinkButton";
import type { MarketingUrls } from "./marketing-screenshots";

export function MarketingShell({
  urls,
  children,
}: {
  urls: MarketingUrls;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[var(--color-surface)] text-[var(--color-text)]">
      <div className="bg-page-gradient pointer-events-none fixed inset-0 opacity-30" aria-hidden />
      <header className="relative z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight">
            Domi Ops
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3" aria-label="Site">
            <AnchorButton
              href={urls.setupDocs}
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
            >
              Docs
            </AnchorButton>
            <LinkButton href="/pricing" variant="ghost" size="sm" className="hidden sm:inline-flex">
              Pricing
            </LinkButton>
            <AnchorButton href={urls.appLogin} variant="secondary" size="sm">
              Log in
            </AnchorButton>
          </nav>
        </div>
      </header>
      <main className="relative z-10">{children}</main>
      <footer className="relative z-10 border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-[var(--color-text-muted)] sm:px-6">
          <p>© {new Date().getFullYear()} Domi Ops</p>
          <div className="flex flex-wrap gap-4">
            {urls.demo && (
              <AnchorButton href={urls.demo} variant="ghost" size="sm" className="min-h-11">
                Try demo
              </AnchorButton>
            )}
            <a href={urls.appPrivacy} className="min-h-11 inline-flex items-center hover:text-[var(--color-text)]">
              Privacy
            </a>
            <a href="/terms" className="min-h-11 inline-flex items-center hover:text-[var(--color-text)]">
              Terms
            </a>
            <a
              href={urls.github}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-11 inline-flex items-center hover:text-[var(--color-text)]"
            >
              GitHub
            </a>
            <a
              href={urls.setupDocs}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-11 inline-flex items-center hover:text-[var(--color-text)]"
            >
              Self-host guide
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
