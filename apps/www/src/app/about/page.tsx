import { AnchorButton, LinkButton, MarketingShell, resolveMarketingUrls } from "@domi-ops/marketing-ui";

export const metadata = {
  title: "Our story | Domi Ops",
  description:
    "Why Mike Whobrey built Domi Ops: a homeschooling family that needed school records, a reliable calendar, and health tracking that fits a complicated medication schedule.",
  alternates: { canonical: "/about" },
};

// Reads NEXT_PUBLIC_* env vars at render time; see app/page.tsx.
export const dynamic = "force-dynamic";

export default function AboutPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-label text-[var(--color-accent)]">Our story</p>
        <h1 className="mt-2 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Why I built Domi Ops
        </h1>

        <div className="mt-8 space-y-5 text-lg leading-relaxed text-[var(--color-text-muted)]">
          <p>I started building Domi Ops because the tools we used couldn&apos;t keep up with our family.</p>
          <p>
            We ran on HomeHub for a while. It covered the basics, but it had nothing for homeschool
            records or health. We homeschool, and we needed grades, assignments, and records in the
            same place as the family calendar, not in a separate app. We also needed a shared calendar
            that stayed reliable.
          </p>
          <p>
            Health was the biggest gap. My wife manages several conditions, and coordinating her care
            takes precision: the right doses at the right times, and everyone who helps knowing
            what&apos;s going on. Most apps give health a checklist or a notes field, and both fall
            apart once things get complicated.
          </p>
          <p>
            Her medications don&apos;t follow &quot;breakfast, lunch, supper, bedtime.&quot; Some
            repeat every few hours, some are as-needed, and some pause and restart. Pill organizers
            assume a schedule she doesn&apos;t have.
          </p>
          <p>
            Because Domi Ops holds family schedules and medical details, I built it with privacy in
            mind from the start. Sensitive health fields are encrypted, each record is private or
            shared on purpose, and on your own server your data stays there unless you turn on an
            integration like Google sync. It&apos;s open source, so you can run it yourself and check.
          </p>
          <p>
            Everything in Domi Ops comes from our own daily use. When a workflow is slow or clunky, I
            fix it. When we&apos;re missing something, I build it. My family runs on this every day,
            which is the best test I know of.
          </p>
        </div>

        <p className="mt-8 font-display text-lg font-semibold">Mike Whobrey</p>
        <p className="text-sm text-[var(--color-text-muted)]">Domi Ops</p>

        <section className="mt-12 grid items-start gap-6 border-t border-[var(--color-border)] pt-10 sm:grid-cols-[14rem_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static photo, no image optimizer in the standalone build */}
          <img
            src="/about/mike-family.webp"
            alt="Mike Whobrey with his wife and son, standing at a wooden fence"
            width={556}
            height={711}
            className="w-full max-w-56 rounded-[var(--radius-xl)] shadow-[var(--shadow-card)]"
          />
          <div className="space-y-4 text-[var(--color-text-muted)]">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-text)]">
              A little about me
            </h2>
            <p>
              I was born and raised in Mississippi, and I used to ride bulls for a living. These days
              I&apos;m a software engineer, and I have been for over a decade. My wife and I have been
              married for just as long.
            </p>
            <p>
              My focus now is my wife and our son. Our family&apos;s health needs are growing and will
              keep growing, so I spend my time building things that make the days easier to manage. I
              also enjoy coding and creating tools for their own sake.
            </p>
          </div>
        </section>

        <div className="mt-12 flex flex-wrap items-center gap-4 border-t border-[var(--color-border)] pt-8">
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
      </article>
    </MarketingShell>
  );
}
