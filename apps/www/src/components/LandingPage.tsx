import { Lock, ShieldCheck, Ban } from "lucide-react";
import {
  AnchorButton,
  LinkButton,
  MARKETING_SCREENSHOTS,
  MarketingShell,
  ThemeAwareScreenshot,
  resolveMarketingUrls,
} from "@domi-ops/marketing-ui";
import { ALSO_STRIP_ITEMS, MODULE_TILES } from "@/lib/module-tiles";

const DAY_TIMELINE = [
  { time: "6:45 AM", text: "Chore chart buzzes before the bus does. Nobody's asking twice." },
  { time: "8:15 AM", text: "Morning meds get checked off as one group card, not chased down pill by pill." },
  {
    time: "12:30 PM",
    text: "A gradebook entry lands the second the essay's graded. No end-of-term scramble.",
  },
  { time: "4:50 PM", text: "Milk gets added to the list from the car, grouped by aisle by the time you're inside." },
  { time: "9:10 PM", text: "Tomorrow's budget alert fires before the card gets swiped, not after." },
];

export function LandingPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <section className="relative overflow-hidden">
        <div className="bg-dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12 lg:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="space-y-6">
              <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                Run your household like it&apos;s <span className="text-gradient">one system</span>,
                not five apps
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-[var(--color-text-muted)]">
                Calendar, chores, shopping, notes, and expenses, with homeschool tracking built in
                when you need it. Self-host free or run on Domi Ops cloud.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <LinkButton
                  href="/pricing"
                  size="lg"
                  className="shadow-[0_0_0_1px_var(--color-accent),0_8px_24px_-4px_var(--color-accent)]"
                >
                  Get hosted
                </LinkButton>
                {urls.ossRepoPublic ? (
                  <AnchorButton
                    href={urls.setupDocs}
                    variant="secondary"
                    size="lg"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Self-host free
                  </AnchorButton>
                ) : (
                  <LinkButton href="/pricing" variant="secondary" size="lg">
                    Self-host (coming soon)
                  </LinkButton>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Open source · Every module included
              </p>
            </div>

            <div className="relative space-y-4 lg:justify-self-end">
              <div
                className="animate-float absolute -left-4 top-6 z-10 hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium shadow-[var(--shadow-card)] sm:flex sm:items-center sm:gap-1.5"
                aria-hidden
              >
                <Lock className="h-3 w-3 text-[var(--color-accent)]" />
                Health data encrypted
              </div>
              <div
                className="animate-float absolute -right-3 bottom-16 z-10 hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium shadow-[var(--shadow-card)] sm:flex sm:items-center sm:gap-1.5"
                style={{ animationDelay: "1.4s" }}
                aria-hidden
              >
                6 modules, 1 login
              </div>
              <ThemeAwareScreenshot
                {...MARKETING_SCREENSHOTS.heroCalendarWeek}
                alt="Domi Ops calendar week view with family events and school assignment overlays"
                preload
                className="hidden max-w-full rounded-[var(--radius-xl)] shadow-[var(--shadow-elevated)] sm:block lg:max-w-[42rem]"
              />
              <ThemeAwareScreenshot
                {...MARKETING_SCREENSHOTS.heroCalendarWeekMobile}
                alt="Domi Ops calendar agenda on mobile"
                preload
                className="max-w-full rounded-[var(--radius-xl)] shadow-[var(--shadow-elevated)] sm:hidden"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-3xl px-4 py-10 text-center sm:px-6 sm:py-14">
          <p className="text-label text-[var(--color-accent)]">Why switch</p>
          <p className="mt-3 text-lg leading-relaxed text-[var(--color-text-muted)]">
            Cozi for the calendar. A whiteboard for chores. A spreadsheet nobody opens for the
            budget. That's not a system, it's duct tape. Domi Ops replaces it, homeschool
            curriculum included, not required.
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/40">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <p className="font-display text-center text-lg font-medium tracking-tight sm:text-xl">
            6 modules.{" "}
            <span className="text-[var(--color-text-muted)]">1 login.</span>{" "}
            <span className="text-gradient">Zero spreadsheets.</span>
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="max-w-2xl">
            <p className="text-label text-[var(--color-accent)]">Why Domi Ops</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Built for the tracking a calendar app can&apos;t do
            </h2>
            <p className="mt-3 text-[var(--color-text-muted)]">
              Most family organizers stop at reminders. Two things in a household outgrow that fast:
              your kids&apos; education and your family&apos;s health. Neither is a box you check
              once. They're ongoing records, so that's what we built.
            </p>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <div className="group space-y-4">
              <div className="overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-card)] transition group-hover:shadow-[var(--shadow-elevated)]">
                <ThemeAwareScreenshot
                  {...MARKETING_SCREENSHOTS.school}
                  alt="Domi Ops school module showing classes, assignments, and gradebook"
                  className="w-full rounded-none border-0 shadow-none transition duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <div>
                <h3 className="text-lg font-semibold">A full homeschool LMS</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
                  Classes, assignments, submissions, a real gradebook. Progress tracked across the
                  whole year, not a to-do list that resets every Monday.
                </p>
              </div>
            </div>
            <div className="group space-y-4">
              <div className="overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-card)] transition group-hover:shadow-[var(--shadow-elevated)]">
                <ThemeAwareScreenshot
                  {...MARKETING_SCREENSHOTS.health}
                  alt="Domi Ops health module showing medications, events, and vitals"
                  className="w-full rounded-none border-0 shadow-none transition duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Encrypted health tracking</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
                  Medications grouped by dose so nobody gets five pings for one pill organizer.
                  Vitals, appointments, and history, encrypted at rest and shared with exactly who
                  you choose.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="text-label text-[var(--color-accent)]">One Tuesday</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            What a day actually looks like
          </h2>
          <ol className="mt-10 space-y-0">
            {DAY_TIMELINE.map((item, i) => (
              <li key={item.time} className="relative flex gap-5 pb-8 last:pb-0">
                <div className="flex flex-col items-center">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-accent)] bg-[var(--color-surface)] text-xs font-semibold text-[var(--color-accent)]">
                    {i + 1}
                  </span>
                  {i < DAY_TIMELINE.length - 1 ? (
                    <span className="mt-1 w-px flex-1 bg-[var(--color-border)]" aria-hidden />
                  ) : null}
                </div>
                <div className="pt-0.5">
                  <p className="font-display text-sm font-semibold tracking-tight text-[var(--color-accent)]">
                    {item.time}
                  </p>
                  <p className="mt-1 max-w-xl text-[var(--color-text-muted)]">{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything a household runs on
            </h2>
            <p className="mt-3 text-[var(--color-text-muted)]">
              Calendar and chores up front; turn on school, drive, shopping, expenses, and health
              as your household needs them.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {MODULE_TILES.map((tile) => (
              <article
                key={tile.key}
                className={`group overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] transition hover:-translate-y-1 hover:border-[var(--color-accent)]/50 hover:shadow-[var(--shadow-elevated)] ${
                  tile.span === "wide" ? "sm:col-span-2" : ""
                }`}
              >
                {tile.kind === "screenshot" ? (
                  <div className="overflow-hidden">
                    <ThemeAwareScreenshot
                      {...tile.shot}
                      alt={`Domi Ops ${tile.title}`}
                      className="rounded-none border-0 shadow-none transition duration-300 group-hover:scale-[1.03]"
                    />
                  </div>
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
              className="max-w-md shrink-0 rounded-[var(--radius-lg)] shadow-[var(--shadow-card)]"
            />
            <div className="space-y-3">
              <h2 className="text-xl font-semibold">And also</h2>
              <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                Dashboard presence, weather glance, notice board, Web Push reminders, and a PWA you
                can install on family phones. We kept these off the front page. They're not the
                pitch, just there when you reach for them.
              </p>
              <ul className="flex flex-wrap gap-3 text-sm text-[var(--color-text-muted)]">
                {ALSO_STRIP_ITEMS.map(({ icon: Icon, label }) => (
                  <li key={label} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1">
                    <Icon className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid items-stretch gap-0 md:grid-cols-[1fr_auto_1fr] md:gap-6">
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6">
              <h3 className="text-lg font-semibold">Self-host</h3>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--color-text-muted)]">
                <li>MIT license: all modules in the OSS bundle</li>
                <li>Unlimited Drive on your MinIO/S3</li>
                <li>Your Postgres, your rules</li>
                <li>Docker Compose on a VPS or home server</li>
              </ul>
            </div>
            <div className="relative my-2 flex items-center justify-center md:my-0">
              <span className="hidden h-full w-px bg-[var(--color-border)] md:block" aria-hidden />
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-semibold text-[var(--color-text-muted)] md:absolute md:top-1/2 md:-translate-y-1/2">
                OR
              </span>
            </div>
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6">
              <h3 className="text-lg font-semibold">Domi Ops cloud</h3>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--color-text-muted)]">
                <li>Managed hosting: no server babysitting</li>
                <li>Stripe subscription; setup wizard after checkout</li>
                <li>Drive quotas by tier</li>
                <li>Same app you'd self-host, we just run it</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Built for trust</h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col justify-between rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 lg:col-span-2">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-accent)]" aria-hidden />
                <div>
                  <strong className="block text-base text-[var(--color-text)]">
                    Self-hosted means self-hosted
                  </strong>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-muted)]">
                    Run Domi Ops on your own server and the data never leaves it: no phone-home
                    telemetry, no vendor holding your family's calendar hostage. We built the hosted
                    version because setting up a VPS isn't for everyone, not because self-hosting is
                    a second-class option.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
                  <strong className="text-sm text-[var(--color-text)]">Encrypted health fields</strong>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-muted)]">
                  Medications, vitals, and appointments encrypted at rest.
                </p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <div className="flex items-center gap-2">
                  <Ban className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
                  <strong className="text-sm text-[var(--color-text)]">No ads, ever</strong>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-muted)]">
                  Household software, not an ad network wearing a calendar as a costume.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-[var(--color-border)]">
        <div className="bg-dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Stop running your household on <span className="text-gradient">five logins</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--color-text-muted)]">
            Free to self-host, forever. Or skip the server and let us run it.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <LinkButton
              href="/pricing"
              size="lg"
              className="shadow-[0_0_0_1px_var(--color-accent),0_8px_24px_-4px_var(--color-accent)]"
            >
              Get hosted
            </LinkButton>
            {urls.ossRepoPublic ? (
              <AnchorButton href={urls.setupDocs} variant="secondary" size="lg" target="_blank" rel="noopener noreferrer">
                Self-host free
              </AnchorButton>
            ) : (
              <LinkButton href="/pricing" variant="secondary" size="lg">
                Self-host (coming soon)
              </LinkButton>
            )}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
