/** Pricing display — update docs/marketing/PRICING_TIERS.md is the source of truth for values. */
export type PricingTier = {
  id: string;
  name: string;
  priceLabel: string;
  /** Shown next to priceLabel, e.g. "/mo" — omit for tiers without a recurring cadence. */
  priceSuffix?: string;
  description: string;
  modules: string;
  drive: string;
  isolation: string;
  /** Card gets an accent border + "Most households" badge. At most one tier should set this. */
  highlight?: boolean;
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
        id: "starter",
        name: "Domi Ops Cloud",
        priceLabel: "$12",
        priceSuffix: "/mo, or $120/yr",
        description: "One subscription for your household. A 14-day trial, with a card required. Renews automatically unless canceled.",
        highlight: true,
        modules: "School, calendar, health, files, goals and household planning",
        drive: "25 GB of household file storage",
        isolation: "Separate logins for adults and children, with roles and sharing controls",
        cta: checkoutEnabled
          ? {
              kind: "checkout",
              options: [
                { plan: "monthly", label: "Start trial — then $12/month" },
                { plan: "annual", label: "Start trial — then $120/year" },
              ],
            }
          : { kind: "link", label: "Ask about Cloud access", href: "mailto:support@domi-ops.com", external: true },
      },
      {
        id: "self-host",
        name: "Self-host",
        priceLabel: "Free",
        description: "The same open-source app on a server you manage. MIT license.",
        modules: "All modules included",
        drive: "Storage depends on your server",
        isolation: "You manage setup, updates and backups",
        cta: ossRepoPublic()
          ? { kind: "link", label: "Self-host guide", href: "https://github.com/mwhobrey/domi-ops/blob/main/docs/SETUP.md", external: true }
          : { kind: "link", label: "Ask about self-hosting", href: "mailto:support@domi-ops.com", external: true },
      },
    ],
  };
}
