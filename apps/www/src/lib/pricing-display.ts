/** Static pricing display — update when docs/marketing/PRICING_TIERS.md is filled. */
export type PricingTier = {
  id: string;
  name: string;
  priceLabel: string;
  description: string;
  modules: string;
  drive: string;
  isolation: string;
  cta: { label: string; href: string; external?: boolean; disabled?: boolean };
};

export const PRICING_DISPLAY: {
  hostedCheckoutEnabled: boolean;
  tiers: PricingTier[];
} = {
  hostedCheckoutEnabled: false,
  tiers: [
    {
      id: "self-host",
      name: "Self-host OSS",
      priceLabel: "Free",
      description: "MIT license. Run on your server with Docker Compose.",
      modules: "All modules",
      drive: "Unlimited",
      isolation: "Your Postgres + MinIO",
      cta: {
        label: "Self-host guide",
        href: "https://github.com/mwhobrey/domi-ops/blob/master/docs/SETUP.md",
        external: true,
      },
    },
    {
      id: "starter",
      name: "Domi Ops Cloud",
      priceLabel: "$12/mo",
      description: "Managed cloud on shared infrastructure. 14-day trial (card required).",
      modules: "All modules included",
      drive: "25 GB",
      isolation: "Shared Postgres + RLS",
      cta: {
        label: "Coming soon",
        href: "#",
        disabled: true,
      },
    },
    {
      id: "family",
      name: "Hosted Family",
      priceLabel: "Coming soon",
      description: "Dedicated database per household — available after initial launch.",
      modules: "All modules included",
      drive: "Higher quota TBD",
      isolation: "Dedicated Postgres",
      cta: {
        label: "Coming soon",
        href: "#",
        disabled: true,
      },
    },
  ],
};
