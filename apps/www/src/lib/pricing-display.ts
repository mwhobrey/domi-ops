/** Pricing display — update docs/marketing/PRICING_TIERS.md is the source of truth for values. */
export type PricingTier = {
  id: string;
  name: string;
  priceLabel: string;
  description: string;
  modules: string;
  drive: string;
  isolation: string;
  cta:
    | { kind: "link"; label: string; href: string; external?: boolean }
    | { kind: "disabled"; label: string }
    | { kind: "checkout"; options: { plan: "monthly" | "annual"; label: string }[] };
};

/**
 * Both flags are read live (server components re-evaluate per request in this Next.js app,
 * see MarketingShell/LandingPage — no client bundle involved), so flipping the env var on the
 * running container is enough — no rebuild needed.
 */
function ossRepoPublic(): boolean {
  return process.env.NEXT_PUBLIC_OSS_REPO_PUBLIC === "true";
}

function hostedCheckoutEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HOSTED_CHECKOUT_ENABLED === "true";
}

export function getPricingDisplay(): {
  hostedCheckoutEnabled: boolean;
  tiers: PricingTier[];
} {
  const checkoutEnabled = hostedCheckoutEnabled();

  return {
    hostedCheckoutEnabled: checkoutEnabled,
    tiers: [
      {
        id: "self-host",
        name: "Self-host OSS",
        priceLabel: "Free",
        description: "MIT license. Run on your server with Docker Compose.",
        modules: "All modules",
        drive: "Unlimited",
        isolation: "Your Postgres + MinIO",
        cta: ossRepoPublic()
          ? {
              kind: "link",
              label: "Self-host guide",
              href: "https://github.com/mwhobrey/domi-ops/blob/main/docs/SETUP.md",
              external: true,
            }
          : { kind: "disabled", label: "Coming soon" },
      },
      {
        id: "starter",
        name: "Domi Ops Cloud",
        priceLabel: "$12/mo or $120/yr",
        description: "Managed cloud on shared infrastructure. 14-day trial (card required).",
        modules: "All modules included",
        drive: "25 GB",
        isolation: "Shared Postgres + RLS",
        cta: checkoutEnabled
          ? {
              kind: "checkout",
              options: [
                { plan: "monthly", label: "Start trial — monthly" },
                { plan: "annual", label: "Start trial — annual (2 months free)" },
              ],
            }
          : { kind: "disabled", label: "Coming soon" },
      },
      {
        id: "family",
        name: "Hosted Family",
        priceLabel: "Coming soon",
        description: "Dedicated database per household — available after initial launch.",
        modules: "All modules included",
        drive: "Higher quota TBD",
        isolation: "Dedicated Postgres",
        cta: { kind: "disabled", label: "Coming soon" },
      },
    ],
  };
}
