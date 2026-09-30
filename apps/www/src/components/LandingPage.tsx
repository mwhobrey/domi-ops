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
  { time: "7:45 AM", text: "Morning meds get checked off as one group card, not chased down pill by pill." },
  {
    time: "9:00 AM",
    text: "Today's assignments are waiting in each kid's own view. You see the same class as the teacher.",
  },
  {
    time: "11:30 AM",
    text: "The in-app quiz scores itself the second it's submitted. You review the misses, not the whole stack.",
  },
  {
    time: "1:15 PM",
    text: "Essay graded, gradebook updated, category weights already applied. No end-of-term scramble.",
  },
  { time: "4:50 PM", text: "Milk gets added to the list from the car, grouped by aisle by the time you're inside." },
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
                The household hub for <span className="text-gradient">homeschool families</span>
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-[var(--color-text-muted)]">
                Classes, assignments, and a real gradebook next to the family calendar, chores, and
                medications. One login, one household. Self-host free or run on Domi Ops cloud.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                {urls.demo ? (
                  <AnchorButton
                    href={urls.demo}
                    size="lg"
                    className="shadow-[0_0_0_1px_var(--color-accent),0_8px_24px_-4px_var(--color-accent)]"
                  >
                    Try the demo
                  </AnchorButton>
                ) : null}
                <LinkButton href="/pricing" variant="secondary" size="lg">
                  See pricing
                </LinkButton>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                No setup needed to look around · 14-day trial, then $12/mo · Open source, self-host
                free
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
                School + health, 1 login
              </div>
              <ThemeAwareScreenshot
                {...MARKETING_SCREENSHOTS.schoolGradebook}
                alt="Domi Ops gradebook showing a homeschool student's grades by class and category"
                preload
                className="hidden max-w-full rounded-[var(--radius-xl)] shadow-[var(--shadow-elevated)] sm:block lg:max-w-[42rem]"
              />
              <ThemeAwareScreenshot
                {...MARKETING_SCREENSHOTS.schoolMobile}
                alt="Domi Ops school module on mobile"
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
            A planner for the schedule. A spreadsheet for grades. A pill box and a sticky note for
            medications. A chore whiteboard nobody updates. That's not a system, it's duct tape.
            Domi Ops puts school, health, and the rest of the house in one place, so what you
            teach, what you track, and what you do today all live together.
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="space-y-4">
              <p className="text-label text-[var(--color-accent)]">Homeschool</p>
              <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                A real school system, run from your kitchen table
              </h2>
              <p className="text-[var(--color-text-muted)]">
                Most family organizers stop at reminders. Teaching kids at home is an ongoing
                record, so we built the record.
              </p>
              <ul className="space-y-3 text-sm leading-relaxed text-[var(--color-text-muted)]">
                <li>Kids see their own work. You see and grade everything.</li>
                <li>
                  A gradebook with weighted categories, tracked across the whole year instead of
                  resetting every Monday.
                </li>
                <li>In-app tests that grade themselves, with an override on any answer.</li>
                <li>
                  Tap the days school happened instead of taking roll. Log hours as you go, then print a
                  transcript on your own grading scale.
                </li>
                <li>
                  Hand out a Google Doc as a test and each student gets their own copy back. The original
                  freezes at first submission.
                </li>
                <li>Assignments show up on the family calendar.</li>
              </ul>
              <LinkButton href="/homeschool" variant="secondary">
                More on homeschool
              </LinkButton>
            </div>
            <div className="overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-card)]">
              <ThemeAwareScreenshot
                {...MARKETING_SCREENSHOTS.school}
                alt="Domi Ops school module showing classes, assignments, and gradebook"
                className="w-full rounded-none border-0 shadow-none"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-card)]">
              <ThemeAwareScreenshot
                {...MARKETING_SCREENSHOTS.health}
                alt="Domi Ops health module showing medications, events, and vitals"
                className="w-full rounded-none border-0 shadow-none"
              />
            </div>
            <div className="space-y-4">
              <p className="text-label text-[var(--color-accent)]">Health</p>
              <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                The health side of running a household
              </h2>
              <p className="text-[var(--color-text-muted)]">
                Medications, appointments, and vitals for everyone in the house, shared with exactly
                who you choose.
              </p>
              <ul className="space-y-3 text-sm leading-relaxed text-[var(--color-text-muted)]">
                <li>
                  One reminder for the pill organizer, not five pings for five pills.
                </li>
                <li>Pause a medication and its dose history stays.</li>
                <li>
                  Medication names, doses, and notes are encrypted at rest, and being able to see a
                  record never lets someone edit it.
                </li>
                <li>
                  Domi Ops is a household tool, not a medical record system, and it makes no HIPAA
                  claims.
                </li>
              </ul>
              <LinkButton href="/health" variant="secondary">
                More on health
              </LinkButton>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
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
              And everything else a household runs on
            </h2>
            <p className="mt-3 text-[var(--color-text-muted)]">
              The rest of the house, included in every plan. Turn modules on as your household needs
              them.
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
                    Run Domi Ops on your own server and your household records stay there. A feature
                    that calls an outside service, like weather or Google sync, only does so once you
                    set it up. Telemetry is off unless you opt in, and no vendor holds your family's
                    calendar hostage. We built the hosted
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

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-12 text-center sm:flex-row sm:px-6 sm:py-16 sm:text-left">
          {/* eslint-disable-next-line @next/next/no-img-element -- static photo, no image optimizer in the standalone build */}
          <img
            src="/about/mike-family.webp"
            alt="Mike Whobrey and his wife smiling for a selfie at a national forest overlook"
            width={715}
            height={693}
            className="h-28 w-28 shrink-0 rounded-full object-cover shadow-[var(--shadow-card)]"
          />
          <div className="space-y-3">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Built by a homeschooling family
            </h2>
            <p className="text-[var(--color-text-muted)]">
              I&apos;m Mike. My family homeschools and manages health needs every day, and Domi Ops
              started as the tool we couldn&apos;t find. We still run our own household on it.
            </p>
            <LinkButton href="/about" variant="secondary">
              Read our story
            </LinkButton>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-[var(--color-border)]">
        <div className="bg-dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Teach, track, and run the house from <span className="text-gradient">one place</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--color-text-muted)]">
            Free to self-host, forever. Or skip the server and let us run it.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {urls.demo ? (
              <AnchorButton
                href={urls.demo}
                size="lg"
                className="shadow-[0_0_0_1px_var(--color-accent),0_8px_24px_-4px_var(--color-accent)]"
              >
                Try the demo
              </AnchorButton>
            ) : null}
            <LinkButton href="/pricing" variant="secondary" size="lg">
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
