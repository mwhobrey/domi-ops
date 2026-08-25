import {
  AnchorButton,
  LinkButton,
  MARKETING_SCREENSHOTS,
  MarketingShell,
  ThemeAwareScreenshot,
  resolveMarketingUrls,
} from "@domi-ops/marketing-ui";
import { ALSO_STRIP_ICONS, MODULE_TILES } from "@/lib/module-tiles";

export function LandingPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
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
              {urls.ossRepoPublic ? (
                <AnchorButton href={urls.setupDocs} variant="secondary" target="_blank" rel="noopener noreferrer">
                  Self-host free
                </AnchorButton>
              ) : (
                <LinkButton href="/pricing" variant="secondary">
                  Self-host (coming soon)
                </LinkButton>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Open source · MIT · Docker Compose · Every module included
            </p>
          </div>

          <div className="space-y-4 lg:justify-self-end">
            <ThemeAwareScreenshot
              {...MARKETING_SCREENSHOTS.heroCalendarWeek}
              alt="Domi Ops calendar week view with family events and school assignment overlays"
              preload
              className="hidden max-w-full sm:block lg:max-w-[42rem]"
            />
            <ThemeAwareScreenshot
              {...MARKETING_SCREENSHOTS.heroCalendarWeekMobile}
              alt="Domi Ops calendar agenda on mobile"
              preload
              className="max-w-full sm:hidden"
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
              School and calendar up front; add drive, chores, shopping, expenses, health, and
              notes when you need them.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {MODULE_TILES.map((tile) => (
              <article
                key={tile.key}
                className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                {tile.kind === "screenshot" ? (
                  <ThemeAwareScreenshot
                    {...tile.shot}
                    alt={`Domi Ops ${tile.title}`}
                    className="rounded-none border-0 shadow-none"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center bg-[var(--color-surface-subtle)]">
                    <tile.icon className="h-12 w-12 text-[var(--color-accent)]" aria-hidden />
                  </div>
                )}
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
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-6 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 lg:flex-row lg:items-center lg:gap-10">
            <ThemeAwareScreenshot
              {...MARKETING_SCREENSHOTS.dashboard}
              alt="Domi Ops dashboard with today at a glance"
              className="max-w-md shrink-0"
            />
            <div className="space-y-3">
              <h2 className="text-xl font-semibold">And also</h2>
              <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                Dashboard presence, weather glance, notice board, Web Push reminders, and a PWA you
                can install on family phones — without six more tiles on the landing page.
              </p>
              <ul className="flex flex-wrap gap-3 text-sm text-[var(--color-text-muted)]">
                {ALSO_STRIP_ICONS.map((Icon, i) => (
                  <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1">
                    <Icon className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
                    <span>{["Presence", "PWA", "Push"][i]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-2">
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6">
            <h3 className="text-lg font-semibold">Self-host</h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--color-text-muted)]">
              <li>MIT license — all modules in the OSS bundle</li>
              <li>Unlimited Drive on your MinIO/S3</li>
              <li>Your Postgres, your rules</li>
              <li>Docker Compose on a VPS or home server</li>
            </ul>
          </div>
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6">
            <h3 className="text-lg font-semibold">Domi Ops cloud</h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--color-text-muted)]">
              <li>Managed hosting — no server babysitting</li>
              <li>Stripe subscription; setup wizard after checkout</li>
              <li>Drive quotas by tier</li>
              <li>Same app you can self-host</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Built for trust</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            <li className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm leading-relaxed text-[var(--color-text-muted)]">
              <strong className="block text-[var(--color-text)]">Self-hosted privacy</strong>
              Your data stays on your server when you self-host — no vendor lock-in.
            </li>
            <li className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm leading-relaxed text-[var(--color-text-muted)]">
              <strong className="block text-[var(--color-text)]">Encrypted health fields</strong>
              Sensitive health data encrypted at rest when the health module is enabled.
            </li>
            <li className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm leading-relaxed text-[var(--color-text-muted)]">
              <strong className="block text-[var(--color-text)]">No ads</strong>
              Household software, not an ad network — unlike free-tier family organizers.
            </li>
          </ul>
        </div>
      </section>
    </MarketingShell>
  );
}
