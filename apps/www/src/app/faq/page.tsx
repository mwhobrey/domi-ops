import { MarketingShell, resolveMarketingUrls } from "@domi-ops/marketing-ui";
import { FAQ_ITEMS, faqJsonLd } from "@/lib/faq";

export const metadata = {
  title: "FAQ | Domi Ops",
  description:
    "Common questions about homeschool tracking, health data, self-hosting, Domi Ops Cloud, privacy, and pricing.",
};

// Reads NEXT_PUBLIC_* env vars at render time — see app/page.tsx for why this has to be forced
// dynamic or those values freeze at build time.
export const dynamic = "force-dynamic";

export default function FaqPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(FAQ_ITEMS)) }}
      />
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
