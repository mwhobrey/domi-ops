# Pricing tiers

**Status:** Locked for launch planning (Mike, 2026-06-24)  
Source of truth for [WHO-181](https://linear.app/mikewhob-whome/issue/WHO-181) pricing page and [WHO-185](https://linear.app/mikewhob-whome/issue/WHO-185) Stripe SKUs.

## Launch scope

- [x] **Starter only at launch**
- [ ] Starter + Family at launch (Family deferred — see below)

**Rationale:** One shared Postgres + RLS stack, one Stripe Product, minimal provisioning ops. Family (dedicated DB per household) ships after WHO-177/178 without repricing Starter.

## Hosted Starter — **Domi Ops Cloud**

| Field | Value |
|-------|-------|
| Display name | Domi Ops Cloud (internal tier: `hosted_starter`) |
| Monthly price | **$12/mo** |
| Annual price | **$120/yr** (2 months free vs monthly) |
| Trial | **14 days** |
| Card required for trial | **Yes** |
| `modules_entitled` | **All modules** (`core`, `school`, `calendar_sync`, `drive`, `health`) |
| `storage_quota_bytes` | **25 GB** (26,843,545,600 bytes) |

### Module packaging decision

**Locked:** All modules included in base Starter price.

| Approach | Launch |
|----------|--------|
| All modules in base | **Yes** — simpler Stripe, stronger value story, one entitlement check |
| Per-module à-la-carte | **No** — too many SKUs and support edge cases for v1 |
| Single “module extensions” add-on | **Deferred** — revisit if we need a price ladder without splitting the catalog |

`demo.domi-ops.com` remains the no-card playground; paid trial is card-required to limit abuse.

## Hosted Family

**Deferred** — not sold at launch. Pricing page shows “Coming soon.”

| Field | Value |
|-------|-------|
| Monthly price | TBD (target: premium over Starter when dedicated DB ships) |
| Annual price | TBD |
| `modules_entitled` | All modules (same bundle as Starter) |
| `storage_quota_bytes` | TBD (higher than Starter — e.g. 100 GB) |
| DB isolation | Dedicated Postgres per household (per WHO-177) |

## Self-host OSS

| Field | Value |
|-------|-------|
| Price | Free (MIT) |
| Modules | All in `MODULES_ENABLED` deploy catalog |
| Drive storage | Unlimited (`storage_quota_bytes = NULL`) |

## Module add-ons

**None at launch.** Table reserved for a future single “extensions” SKU or storage upsell — not per-module à-la-carte.

| Module key | Display name | Monthly add-on |
|------------|--------------|----------------|
| — | — | — |

## Stripe (when ready)

Create **one Product** (“Domi Ops Cloud”) with two Prices, then paste IDs here:

```env
STRIPE_PRICE_STARTER_MONTHLY=price_
STRIPE_PRICE_STARTER_ANNUAL=price_
# Family — create when tier ships
# STRIPE_PRICE_FAMILY_MONTHLY=price_
# STRIPE_PRICE_FAMILY_ANNUAL=price_
```

Webhook endpoint: `https://app.domi-ops.com/api/billing/webhook` (see [STRIPE_SETUP.md](./STRIPE_SETUP.md)).

## Economics (operator reference)

| Fixed infra (single DO stack, rough) | ~$30–40/mo |
|--------------------------------------|------------|
| Net per household @ $12/mo (after Stripe) | ~$11.65 |
| Break-even (infra only) | ~4–5 paying households |
| Comfortable margin | ~10+ households |
