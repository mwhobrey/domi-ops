import {
  AnchorButton,
  LinkButton,
  MarketingShell,
  SubmitButton,
  resolveMarketingUrls,
} from "@domi-ops/marketing-ui";
import { getPricingDisplay, type PricingTier } from "@/lib/pricing-display";

export const metadata = {
  title: "Pricing — Domi Ops",
  description: "Self-host free or choose a Domi Ops cloud plan.",
};

function TierCta({
  cta,
  checkoutUrl,
  size = "sm",
}: {
  cta: PricingTier["cta"];
  checkoutUrl: string;
  size?: "sm" | "md";
}) {
  if (cta.kind === "disabled") {
    return <span className="text-sm text-[var(--color-text-muted)]">{cta.label}</span>;
  }
  if (cta.kind === "checkout") {
    return (
      <div className="flex flex-col items-start gap-2">
        {cta.options.map((option) => (
          <form key={option.plan} action={checkoutUrl} method="POST">
            <input type="hidden" name="plan" value={option.plan} />
            <SubmitButton size={size} variant={option.plan === "monthly" ? "primary" : "secondary"}>
              {option.label}
            </SubmitButton>
          </form>
        ))}
      </div>
    );
  }
  return cta.external ? (
    <AnchorButton href={cta.href} variant="secondary" size={size} target="_blank" rel="noopener noreferrer">
      {cta.label}
    </AnchorButton>
  ) : (
    <LinkButton href={cta.href} size={size}>
      {cta.label}
    </LinkButton>
  );
}

export default function PricingPage() {
  const urls = resolveMarketingUrls();
  const pricing = getPricingDisplay();
  const checkoutUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://app.domi-ops.com").replace(/\/$/, "")}/api/billing/checkout`;

  return (
    <MarketingShell urls={urls}>
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="max-w-2xl space-y-4">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Pricing</h1>
          <p className="text-lg text-[var(--color-text-muted)]">
            Self-host the full bundle for free, forever. Or let us run it — same app, no server to
            patch at 11pm.
          </p>
          {!pricing.hostedCheckoutEnabled && (
            <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
              Hosted checkout opens soon — $12/mo or $120/yr after a 14-day trial. See{" "}
              <code className="text-xs">docs/marketing/PRICING_TIERS.md</code> for Stripe setup.
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
              {pricing.tiers.map((tier) => (
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
                    <TierCta cta={tier.cta} checkoutUrl={checkoutUrl} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 grid gap-6 md:hidden">
          {pricing.tiers.map((tier) => (
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
                <TierCta cta={tier.cta} checkoutUrl={checkoutUrl} size="md" />
              </div>
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
