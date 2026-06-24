# Pricing tiers (Mike — fill before launch)

Source of truth for [WHO-181](https://linear.app/mikewhob-whome/issue/WHO-181) pricing page and [WHO-185](https://linear.app/mikewhob-whome/issue/WHO-185) Stripe SKUs.

## Launch scope

- [ ] Starter only at launch
- [ ] Starter + Family at launch

## Hosted Starter

| Field | Value |
|-------|-------|
| Monthly price | $___ |
| Annual price (optional) | $___ |
| Trial | ___ days / none |
| Card required for trial | yes / no |
| `modules_entitled` | [ ] all modules [ ] list: ___ |
| `storage_quota_bytes` | ___ GB |

## Hosted Family

| Field | Value |
|-------|-------|
| Monthly price | $___ |
| Annual price (optional) | $___ |
| `modules_entitled` | ___ |
| `storage_quota_bytes` | ___ GB |
| DB isolation | Dedicated Postgres (per WHO-177) |

## Self-host OSS

| Field | Value |
|-------|-------|
| Price | Free (MIT) |
| Modules | All in `MODULES_ENABLED` deploy catalog |
| Drive storage | Unlimited (`storage_quota_bytes = NULL`) |

## Module add-ons (if any)

Leave empty if all modules are bundled in base tier.

| Module key | Display name | Monthly add-on |
|------------|--------------|----------------|
| `school` | Homeschool LMS | $___ |
| `calendar_sync` | Google Calendar sync | $___ |
| `drive` | Household Drive | $___ |
| `health` | Health tracker | $___ |

## Stripe (when ready)

Create Products/Prices in Stripe Dashboard, then paste Price IDs here:

```env
STRIPE_PRICE_STARTER_MONTHLY=price_
STRIPE_PRICE_STARTER_ANNUAL=price_
STRIPE_PRICE_FAMILY_MONTHLY=price_
STRIPE_PRICE_FAMILY_ANNUAL=price_
```

Webhook endpoint: `https://app.domi-ops.com/api/billing/webhook` (see [STRIPE_SETUP.md](./STRIPE_SETUP.md)).
