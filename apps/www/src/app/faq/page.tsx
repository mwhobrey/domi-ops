import { MarketingShell, resolveMarketingUrls } from "@domi-ops/marketing-ui";

export const metadata = {
  title: "FAQ — Domi Ops",
  description: "Common questions about self-hosting, Domi Ops Cloud, privacy, and pricing.",
};

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Is self-hosting actually free, or is there a catch?",
    a: "Free, MIT license, every module included. There's no feature gate pushing you toward the paid tier. You run it on your own server with Docker Compose and your own Postgres.",
  },
  {
    q: "What's the real difference between self-host and Domi Ops Cloud?",
    a: "Same app either way. Self-host means you manage the server, the database, and backups. Cloud means we do, on shared infrastructure, for $12/mo (or $120/yr). Pick based on whether you already run a server, not on features.",
  },
  {
    q: "Do you sell or share my data?",
    a: "No. Self-hosted, your data never leaves your server; we don't have access to it at all. On Cloud, it stays in your household's isolated data, and it's never sold to anyone, for any reason.",
  },
  {
    q: "Is the health module HIPAA-compliant?",
    a: "No, and it's not trying to be. It's a household tool, not a medical record system. Sensitive fields (medication names, dosage, notes) are encrypted at rest, but Domi Ops isn't a healthcare provider and makes no HIPAA claims.",
  },
  {
    q: "Can I use it without the homeschool stuff?",
    a: "Yes. School is one module among several, off by default until you turn it on. Calendar and chores work fine as a standalone family organizer.",
  },
  {
    q: "What happens to my data if I cancel Cloud?",
    a: "Email us and we delete or anonymize it within a reasonable time, unless we're legally required to hold onto something. There's no lock-in trick where canceling strands your calendar.",
  },
  {
    q: "Does it work on my phone?",
    a: "It's a PWA: install it from the browser on iOS or Android and it behaves like a native app, including push notifications for reminders.",
  },
  {
    q: "Can I try it before setting anything up?",
    a: "Yes, the demo is a live sandbox seeded with a sample household. Poke around before you decide which path to take.",
  },
];

export default function FaqPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-label text-[var(--color-accent)]">FAQ</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Questions people actually ask
        </h1>
        <p className="mt-3 text-lg text-[var(--color-text-muted)]">
          Not finding it here? Check the pricing page, or reach out.
        </p>

        <div className="mt-10 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-[var(--color-text)]">
                {item.q}
                <span
                  className="shrink-0 text-xl text-[var(--color-text-muted)] transition group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-text-muted)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
