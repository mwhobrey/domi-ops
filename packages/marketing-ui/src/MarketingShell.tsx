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
          <Link href="/" className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
            <picture>
              <source srcSet="/icon-on-light.svg" media="(prefers-color-scheme: light)" />
              {/* eslint-disable-next-line @next/next/no-img-element -- shared package, no next/image config to rely on */}
              <img src="/icon-on-dark.svg" alt="" width={28} height={28} className="h-7 w-7" aria-hidden />
            </picture>
            Domi Ops
          </Link>
          <nav className="hidden items-center gap-2 md:flex lg:gap-3" aria-label="Site">
            {urls.ossRepoPublic ? (
              <AnchorButton
                href={urls.setupDocs}
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex"
              >
                Docs
              </AnchorButton>
            ) : (
              <span className="hidden text-sm text-[var(--color-text-muted)] sm:inline-flex">
                Open source
              </span>
            )}
            <LinkButton href="/homeschool" variant="ghost" size="sm" className="hidden md:inline-flex">
              Homeschool
            </LinkButton>
            <LinkButton href="/health" variant="ghost" size="sm" className="hidden md:inline-flex">
              Health
            </LinkButton>
            <LinkButton href="/about" variant="ghost" size="sm" className="hidden lg:inline-flex">
              Our story
            </LinkButton>
            <LinkButton href="/faq" variant="ghost" size="sm" className="hidden sm:inline-flex">
              FAQ
            </LinkButton>
            <LinkButton href="/pricing" variant="ghost" size="sm" className="hidden sm:inline-flex">
              Pricing
            </LinkButton>
            <LinkButton href="/pricing" size="sm">Cloud plan</LinkButton>
            <AnchorButton href={urls.appLogin} variant="secondary" size="sm">
              Log in
            </AnchorButton>
          </nav>
          <details className="relative md:hidden">
            <summary className="flex min-h-11 cursor-pointer items-center rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">Menu</summary>
            <nav aria-label="Mobile site" className="absolute right-0 top-full z-20 mt-2 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-elevated)]">
              <LinkButton href="/pricing" size="sm">Cloud plan and pricing</LinkButton>
              <LinkButton href="/homeschool" variant="ghost" size="sm">Homeschool</LinkButton>
              <LinkButton href="/health" variant="ghost" size="sm">Health</LinkButton>
              <LinkButton href="/faq" variant="ghost" size="sm">FAQ</LinkButton>
              <LinkButton href="/about" variant="ghost" size="sm">Our story</LinkButton>
              <AnchorButton href={urls.appLogin} variant="secondary" size="sm">Log in</AnchorButton>
              {urls.demo && <AnchorButton href={urls.demo} variant="ghost" size="sm">Try the demo</AnchorButton>}
              {urls.ossRepoPublic && <AnchorButton href={urls.setupDocs} variant="ghost" size="sm">Self-host guide</AnchorButton>}
              <a href="mailto:support@domi-ops.com" className="inline-flex min-h-11 items-center justify-center text-sm underline">Contact support</a>
            </nav>
          </details>
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
            <Link href="/about" className="min-h-11 inline-flex items-center hover:text-[var(--color-text)]">
              Our story
            </Link>
            <Link href="/privacy" className="min-h-11 inline-flex items-center hover:text-[var(--color-text)]">
              Privacy
            </Link>
            <Link href="/terms" className="min-h-11 inline-flex items-center hover:text-[var(--color-text)]">
              Terms
            </Link>
            <a href="mailto:support@domi-ops.com" className="min-h-11 inline-flex items-center hover:text-[var(--color-text)]">Support</a>
            {urls.ossRepoPublic ? (
              <>
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
              </>
            ) : (
              <a href="mailto:support@domi-ops.com" className="min-h-11 inline-flex items-center">Ask about self-hosting</a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
