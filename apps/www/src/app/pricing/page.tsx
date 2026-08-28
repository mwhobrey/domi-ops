import { Building2, Check, Cloud, Server } from "lucide-react";
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

const TIER_ICON: Record<string, typeof Server> = {
  "self-host": Server,
  starter: Cloud,
  family: Building2,
};

function TierCta({
  cta,
  checkoutUrl,
}: {
  cta: PricingTier["cta"];
  checkoutUrl: string;
}) {
  if (cta.kind === "disabled") {
    return (
      <span className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)]">
        {cta.label}
      </span>
    );
  }
  if (cta.kind === "checkout") {
    return (
      <div className="flex flex-col gap-2">
        {cta.options.map((option) => (
          <form key={option.plan} action={checkoutUrl} method="POST">
            <input type="hidden" name="plan" value={option.plan} />
            <SubmitButton
              size="md"
              variant={option.plan === "monthly" ? "primary" : "secondary"}
              className="w-full"
            >
              {option.label}
            </SubmitButton>
          </form>
        ))}
      </div>
    );
  }
  return cta.external ? (
    <AnchorButton href={cta.href} variant="secondary" size="md" className="w-full" target="_blank" rel="noopener noreferrer">
      {cta.label}
    </AnchorButton>
  ) : (
    <LinkButton href={cta.href} size="md" className="w-full">
      {cta.label}
    </LinkButton>
  );
}

function FeatureRow({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-[var(--color-text-muted)]">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
      {label}
    </li>
  );
}

export default function PricingPage() {
  const urls = resolveMarketingUrls();
  const pricing = getPricingDisplay();
  const checkoutUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://app.domi-ops.com").replace(/\/$/, "")}/api/billing/checkout`;

  return (
    <MarketingShell urls={urls}>
      <section className="relative overflow-hidden">
        <div className="bg-dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="max-w-2xl space-y-4">
            <p className="text-label text-[var(--color-accent)]">Pricing</p>
            <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              Pick who runs the server
            </h1>
            <p className="text-lg text-[var(--color-text-muted)]">
              Self-host the full bundle for free, forever. Or let us run it: same app, no server to
              patch at 11pm.
            </p>
            {!pricing.hostedCheckoutEnabled && (
              <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
                Hosted checkout opens soon. In the meantime, self-host is free and ready today.
              </p>
            )}
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {pricing.tiers.map((tier) => {
              const Icon = TIER_ICON[tier.id] ?? Cloud;
              return (
                <article
                  key={tier.id}
                  className={`relative flex flex-col rounded-[var(--radius-xl)] border p-6 transition hover:-translate-y-1 ${
                    tier.highlight
                      ? "border-[var(--color-accent)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-elevated)] lg:scale-[1.03]"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-[var(--shadow-card)]"
                  }`}
                >
                  {tier.highlight ? (
                    <span className="absolute -top-3 left-6 rounded-full bg-[var(--color-accent)] px-3 py-1 text-xs font-semibold text-white">
                      Most households
                    </span>
                  ) : null}

                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-subtle)]">
                      <Icon className="h-4.5 w-4.5 text-[var(--color-accent)]" aria-hidden />
                    </span>
                    <h2 className="text-lg font-semibold">{tier.name}</h2>
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)]">
                    {tier.description}
                  </p>

                  <p className="mt-6 flex items-baseline gap-1">
                    <span className="font-display text-4xl font-semibold tracking-tight">
                      {tier.priceLabel}
                    </span>
                    {tier.priceSuffix ? (
                      <span className="text-sm text-[var(--color-text-muted)]">{tier.priceSuffix}</span>
                    ) : null}
                  </p>

                  <ul className="mt-6 flex-1 space-y-2.5 border-t border-[var(--color-border)] pt-6">
                    <FeatureRow label={tier.modules} />
                    <FeatureRow label={`${tier.drive} Drive`} />
                    <FeatureRow label={tier.isolation} />
                  </ul>

                  <div className="mt-6">
                    <TierCta cta={tier.cta} checkoutUrl={checkoutUrl} />
                  </div>
                </article>
              );
            })}
          </div>

          <p className="mt-8 text-center text-sm text-[var(--color-text-muted)]">
            Not sure which one? Self-host if you already run a server. Pick cloud if you'd rather
            not.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
