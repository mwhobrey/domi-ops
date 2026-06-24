import Link from "next/link";
import { ThemeAwareScreenshot } from "./ThemeAwareScreenshot";
import { MARKETING_SCREENSHOTS } from "../../lib/marketing-screenshots";
import { AnchorButton, LinkButton } from "../ui";

const MODULE_TILES = [
  {
    key: "school",
    title: "Homeschool LMS",
    description: "Classes, assignments, gradebook, and student progress — beside chores and calendar.",
    shot: MARKETING_SCREENSHOTS.school,
  },
  {
    key: "calendar",
    title: "Calendar + Google sync",
    description: "Week view, recurring events, school overlays, and optional Google import.",
    shot: MARKETING_SCREENSHOTS.heroCalendarWeek,
  },
  {
    key: "drive",
    title: "Household Drive",
    description: "Files, folders, and links shared across school, notes, and notices.",
    shot: MARKETING_SCREENSHOTS.drive,
  },
  {
    key: "chores",
    title: "Chores & karma",
    description: "Assignments, streaks, and redemption quests for the whole household.",
    shot: MARKETING_SCREENSHOTS.chores,
  },
] as const;

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-[var(--color-surface)] text-[var(--color-text)]">
      <div className="bg-page-gradient pointer-events-none fixed inset-0 opacity-30" aria-hidden />

      <header className="relative z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <p className="font-display text-xl font-semibold tracking-tight">Domi Ops</p>
          <nav className="flex items-center gap-2 sm:gap-3">
            <LinkButton href="/pricing" variant="ghost" size="sm" className="hidden sm:inline-flex">
              Pricing
            </LinkButton>
            <LinkButton href="/login" variant="secondary" size="sm">
              Log in
            </LinkButton>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="space-y-6">
              <p className="text-label text-[var(--color-accent)]">Homeschool household hub</p>
              <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                The homeschool household hub
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-[var(--color-text-muted)]">
                Calendar, classes, chores, budgets, and files — one household, one app. Self-host
                free or run on Domi Ops cloud.
              </p>
              <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                Stop duct-taping Cozi, a gradebook, and a spreadsheet. Domi Ops is household
                operations software for families who live in their calendar and their curriculum.
              </p>
              <div className="flex flex-wrap gap-3">
                <LinkButton href="/pricing">Get hosted</LinkButton>
                <AnchorButton
                  href="https://github.com/mwhobrey/whome#self-host"
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="secondary"
                >
                  Self-host free
                </AnchorButton>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Open source · MIT · Docker Compose · Every module included
              </p>
            </div>

            <div className="lg:justify-self-end">
              <ThemeAwareScreenshot
                {...MARKETING_SCREENSHOTS.heroCalendarWeek}
                alt="Domi Ops calendar week view with family events and school assignment overlays"
                preload
                className="max-w-full lg:max-w-[42rem]"
              />
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="mb-10 max-w-2xl">
              <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                Everything a homeschool household runs on
              </h2>
              <p className="mt-3 text-[var(--color-text-muted)]">
                Lead with school and calendar; add drive, chores, expenses, health, and notes when
                you need them.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              {MODULE_TILES.map((tile) => (
                <article
                  key={tile.key}
                  className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                >
                  <ThemeAwareScreenshot
                    {...tile.shot}
                    alt={`Domi Ops ${tile.title}`}
                    className="rounded-none border-0 shadow-none"
                  />
                  <div className="space-y-2 p-5">
                    <h3 className="text-lg font-semibold">{tile.title}</h3>
                    <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                      {tile.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-2">
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6">
              <h3 className="text-lg font-semibold">Self-host</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
                MIT license, all modules, your Postgres and MinIO. Run on a VPS or home server with
                Docker Compose.
              </p>
            </div>
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6">
              <h3 className="text-lg font-semibold">Domi Ops cloud</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
                Managed hosting with Stripe checkout, drive quotas, and the same app you can run
                yourself.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-[var(--color-text-muted)] sm:px-6">
          <p>© {new Date().getFullYear()} Domi Ops</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/privacy" className="hover:text-[var(--color-text)]">
              Privacy
            </Link>
            <a
              href="https://github.com/mwhobrey/whome"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--color-text)]"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
