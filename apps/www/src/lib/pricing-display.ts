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
        href: "https://github.com/mwhobrey/whome/blob/master/docs/SETUP.md",
        external: true,
      },
    },
    {
      id: "starter",
      name: "Hosted Starter",
      priceLabel: "Coming soon",
      description: "Managed Domi Ops cloud on shared infrastructure.",
      modules: "All modules (TBD)",
      drive: "Quota TBD",
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
      description: "Dedicated database per household for higher isolation.",
      modules: "All modules (TBD)",
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
