# Stripe setup checklist (Domi Ops hosted)

Ops steps in Stripe Dashboard — not legal advice. Pricing values: [PRICING_TIERS.md](./PRICING_TIERS.md).

## Prerequisites

- [ ] [PRICING_TIERS.md](./PRICING_TIERS.md) filled
- [ ] [WHO-179](https://linear.app/mikewhob-whome/issue/WHO-179) provisioning API deployed on `app.domi-ops.com`
- [ ] `PUBLIC_APP_URL=https://app.domi-ops.com`

## 1. Products and Prices

In [Stripe Dashboard → Products](https://dashboard.stripe.com/products):

1. Create **Domi Ops Starter** (recurring monthly; optional annual).
2. Create **Domi Ops Family** (if launching Family tier).
3. Copy Price IDs into `PRICING_TIERS.md` and production `.env`.

## 2. API keys

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Use **test mode** keys on staging (`docker-compose.staging.yml` or separate deploy).

## 3. Webhook

| Setting | Value |
|---------|-------|
| Endpoint URL | `https://app.domi-ops.com/api/billing/webhook` |
| Events (minimum) | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` |

## 4. Checkout

- Success URL: `https://app.domi-ops.com/setup?session_id={CHECKOUT_SESSION_ID}`
- Cancel URL: `https://domi-ops.com/pricing`
- Customer portal: enable for plan changes (post-launch upgrades)

## 5. Smoke test (test mode)

1. Pricing page → Starter CTA → Stripe Checkout (test card `4242...`).
2. Webhook creates household + entitlements.
3. Redirect to setup wizard → dashboard.
