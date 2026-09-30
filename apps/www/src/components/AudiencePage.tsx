import type { ReactNode } from "react";
import {
  AnchorButton,
  LinkButton,
  MarketingShell,
  ThemeAwareScreenshot,
  resolveMarketingUrls,
  type MarketingScreenshot,
} from "@domi-ops/marketing-ui";
import { faqJsonLd, type FaqItem } from "@/lib/faq";

export type AudiencePageProps = {
  eyebrow: string;
  headline: ReactNode;
  lead: string;
  hero: { shot: MarketingScreenshot; alt: string };
  pillars: { title: string; body: string }[];
  gallery: { shot: MarketingScreenshot; alt: string; caption: string }[];
  /** Honest limits. Rendered as its own block so nobody has to hunt for what isn't there. */
  notYet: { title: string; body: string };
  faq: FaqItem[];
  closing: { title: string; body: string };
};

const CTA_GLOW = "shadow-[0_0_0_1px_var(--color-accent),0_8px_24px_-4px_var(--color-accent)]";

export function AudiencePage(props: AudiencePageProps) {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(props.faq)) }}
      />

      <section className="relative overflow-hidden">
        <div className="bg-dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12 lg:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="space-y-6">
              <p className="text-label text-[var(--color-accent)]">{props.eyebrow}</p>
              <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
                {props.headline}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-[var(--color-text-muted)]">
                {props.lead}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                {urls.demo ? (
                  <AnchorButton href={urls.demo} size="lg" className={CTA_GLOW}>
                    Try the demo
                  </AnchorButton>
                ) : null}
                <LinkButton href="/pricing" variant="secondary" size="lg">
                  See pricing
                </LinkButton>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                14-day trial, then $12/mo · Open source, self-host free
              </p>
            </div>
            <ThemeAwareScreenshot
              {...props.hero.shot}
              alt={props.hero.alt}
              preload
              className="max-w-full rounded-[var(--radius-xl)] shadow-[var(--shadow-elevated)] lg:justify-self-end"
            />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid gap-6 sm:grid-cols-2">
            {props.pillars.map((p) => (
              <article
                key={p.title}
                className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
              >
                <h2 className="text-lg font-semibold">{p.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
                  {p.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2">
          {props.gallery.map((g) => (
            <figure key={g.caption} className="space-y-3">
              <div className="overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-card)]">
                <ThemeAwareScreenshot
                  {...g.shot}
                  alt={g.alt}
                  className="w-full rounded-none border-0 shadow-none"
                />
              </div>
              <figcaption className="text-sm text-[var(--color-text-muted)]">{g.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6">
            <h2 className="text-lg font-semibold">{props.notYet.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
              {props.notYet.body}
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Common questions</h2>
          <div className="mt-6 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
            {props.faq.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
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
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-[var(--color-border)]">
        <div className="bg-dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <h2 className="font-display text-3xl font-semibold tracking-tight">{props.closing.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--color-text-muted)]">{props.closing.body}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {urls.demo ? (
              <AnchorButton href={urls.demo} size="lg" className={CTA_GLOW}>
                Try the demo
              </AnchorButton>
            ) : null}
            <LinkButton href="/pricing" variant="secondary" size="lg">
              Get hosted
            </LinkButton>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
