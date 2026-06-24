import {
  AnchorButton,
  LinkButton,
  MarketingShell,
  resolveMarketingUrls,
} from "@whome/marketing-ui";
import { PRICING_DISPLAY } from "@/lib/pricing-display";

export const metadata = {
  title: "Pricing — Domi Ops",
  description: "Self-host free or choose a Domi Ops cloud plan.",
};

export default function PricingPage() {
  const urls = resolveMarketingUrls();

  return (
    <MarketingShell urls={urls}>
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="max-w-2xl space-y-4">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Pricing</h1>
          <p className="text-lg text-[var(--color-text-muted)]">
            Self-host the full OSS bundle for free. Hosted plans include managed infrastructure and
            support for household operations at scale.
          </p>
          {!PRICING_DISPLAY.hostedCheckoutEnabled && (
            <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
              Hosted checkout is coming soon. Fill{" "}
              <code className="text-xs">docs/marketing/PRICING_TIERS.md</code> to enable live
              pricing and Stripe.
            </p>
          )}
        </div>

        <div className="mt-10 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
            <caption className="sr-only">Domi Ops pricing comparison</caption>
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="col" className="py-3 pr-4 font-medium">
                  Plan
                </th>
                <th scope="col" className="py-3 px-4 font-medium">
                  Price
                </th>
                <th scope="col" className="py-3 px-4 font-medium">
                  Modules
                </th>
                <th scope="col" className="py-3 px-4 font-medium">
                  Drive
                </th>
                <th scope="col" className="py-3 px-4 font-medium">
                  Data
                </th>
                <th scope="col" className="py-3 pl-4 font-medium">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {PRICING_DISPLAY.tiers.map((tier) => (
                <tr key={tier.id} className="border-b border-[var(--color-border)]">
                  <th scope="row" className="py-4 pr-4 align-top font-semibold">
                    {tier.name}
                    <p className="mt-1 font-normal text-[var(--color-text-muted)]">
                      {tier.description}
                    </p>
                  </th>
                  <td className="py-4 px-4 align-top">{tier.priceLabel}</td>
                  <td className="py-4 px-4 align-top text-[var(--color-text-muted)]">
                    {tier.modules}
                  </td>
                  <td className="py-4 px-4 align-top text-[var(--color-text-muted)]">
                    {tier.drive}
                  </td>
                  <td className="py-4 px-4 align-top text-[var(--color-text-muted)]">
                    {tier.isolation}
                  </td>
                  <td className="py-4 pl-4 align-top">
                    {tier.cta.disabled ? (
                      <span className="text-[var(--color-text-muted)]">{tier.cta.label}</span>
                    ) : tier.cta.external ? (
                      <AnchorButton
                        href={tier.cta.href}
                        variant="secondary"
                        size="sm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tier.cta.label}
                      </AnchorButton>
                    ) : (
                      <LinkButton href={tier.cta.href} size="sm">
                        {tier.cta.label}
                      </LinkButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 grid gap-6 md:hidden">
          {PRICING_DISPLAY.tiers.map((tier) => (
            <article
              key={tier.id}
              className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5"
            >
              <h2 className="text-lg font-semibold">{tier.name}</h2>
              <p className="mt-1 text-2xl font-semibold">{tier.priceLabel}</p>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{tier.description}</p>
              <dl className="mt-4 space-y-2 text-sm">
                <div>
                  <dt className="font-medium">Modules</dt>
                  <dd className="text-[var(--color-text-muted)]">{tier.modules}</dd>
                </div>
                <div>
                  <dt className="font-medium">Drive</dt>
                  <dd className="text-[var(--color-text-muted)]">{tier.drive}</dd>
                </div>
                <div>
                  <dt className="font-medium">Data</dt>
                  <dd className="text-[var(--color-text-muted)]">{tier.isolation}</dd>
                </div>
              </dl>
              <div className="mt-4">
                {tier.cta.disabled ? (
                  <span className="text-sm text-[var(--color-text-muted)]">{tier.cta.label}</span>
                ) : tier.cta.external ? (
                  <AnchorButton
                    href={tier.cta.href}
                    variant="secondary"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {tier.cta.label}
                  </AnchorButton>
                ) : (
                  <LinkButton href={tier.cta.href}>{tier.cta.label}</LinkButton>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
