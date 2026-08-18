# Public launch (OSS + hosted)

*Prioritize this file over module polish unless a household dogfood bug is blocking daily use.*

## Policy

**Near-simultaneous public launch:** OSS self-host and Domi Ops Hosted Starter ship together. Repo and GHCR stay private until both tracks pass go/no-go ([WHO-187](https://linear.app/mikewhob-whome/issue/WHO-187)). Then public flip ([WHO-174](https://linear.app/mikewhob-whome/issue/WHO-174)).

Source of truth: [ADR 001](../../docs/adr/001-public-launch-scope.md). Do **not** open hosted signup or the public repo first.

| Track | Launch shape |
|-------|----------------|
| **OSS** | MIT, Docker Compose, full module bundle, `DEPLOYMENT_MODE=single` |
| **Hosted** | Starter only (`DEPLOYMENT_MODE=shared` + RLS). Family (dedicated DB) is “Coming soon” |
| **Same codebase** | No paywalled modules in git; hosted monetizes via entitlements + Drive quota |

Pricing locked: [PRICING_TIERS.md](../../docs/marketing/PRICING_TIERS.md) — $12/mo / $120/yr, 14-day trial (card required), 25 GB Drive, all modules.

## Dogfood status

- Live single-tenant: `https://whome.whobrey.me` (`DEPLOYMENT_MODE=single`).
- Local QA phases 0–5 passed — [06_DOGFOOD_TEST_PHASES.md](./06_DOGFOOD_TEST_PHASES.md).
- Household product (core, school, calendar, drive, health) is the working dogfood path. **Default queue is launch platform, not new module features.**

## Do not deploy marketing yet

`apps/www` (landing + `/pricing`) is **code-complete, not deployed**. DNS cutover for `domi-ops.com` is not done — [DNS_CUTOVER.md](../../docs/marketing/DNS_CUTOVER.md).

**Blocker:** hosted-ready legal on **www** ([WHO-182](https://linear.app/mikewhob-whome/issue/WHO-182)):

- Canonical pages: `apps/www` `/privacy` and `/terms` (today `/terms` is a placeholder; footer Privacy links to **app** `/privacy`, which is self-host operator copy).
- Copy must cover Domi Ops as **cloud data controller**, Stripe, SMTP, S3, Google OAuth / Calendar / Drive, Web Push, **not HIPAA**, school **not a school of record**, and the self-host vs hosted split.
- After copy exists, app `/privacy` may stay for Google OAuth or redirect to www.
- Fill blank rows in [LAUNCH_DECISIONS.md](../../docs/marketing/LAUNCH_DECISIONS.md) first (legal entity name, demo subdomain, hosting vs dogfood VPS).

Checkout stays off until Stripe: `hostedCheckoutEnabled` in `apps/www/src/lib/pricing-display.ts`.

Deploy recipe (after legal): `docker-compose.marketing.yml` + `deploy/Caddyfile.domi-ops.example`.

## Workstreams (order)

Do not start the OSS public flip before hosted billing + legal + shared-mode staging.

```
WHO-182 legal on www
  → marketing deploy + DNS (www only; checkout still off)
M5 billing (see below)
  → shared-mode staging + npm run test:hosted
WHO-174 public repo + GHCR
  → WHO-187 go/no-go (both tracks)
```

**M5 order** ([ADR 003](../../docs/adr/003-hosted-db-architecture.md)):

1. [WHO-185](https://linear.app/mikewhob-whome/issue/WHO-185) — Stripe SKUs (IDs into `PRICING_TIERS.md` + env)
2. [WHO-199](https://linear.app/mikewhob-whome/issue/WHO-199) / [WHO-179](https://linear.app/mikewhob-whome/issue/WHO-179) — webhook + household provision
3. [WHO-184](https://linear.app/mikewhob-whome/issue/WHO-184) — hosted setup wizard (not the single-tenant `SETUP_TOKEN` path)
4. [WHO-186](https://linear.app/mikewhob-whome/issue/WHO-186) — Drive quota + module ceiling **and subscription status** (`trialing` / `active` / `past_due` / `canceled` are schema-only today — `packages/db/src/schema/billing.ts`; `getHouseholdModuleContext` does not read `status`)

Hosted ops notes: [HOSTED_OPS.md](../../deploy/HOSTED_OPS.md). Leak matrix: [HOSTED_TENANT_TESTS.md](../../docs/HOSTED_TENANT_TESTS.md) (`npm run test:hosted` is **not** in CI yet).

## What is already done (do not redo)

- M3 hosted foundation: RLS `0038`/`0039`, tenant middleware, entitlements ceiling, `docker-compose.hosted.yml`, seed, leak tests — [01_ARCHITECTURE.md](./01_ARCHITECTURE.md), [HOSTED_RLS.md](../../docs/HOSTED_RLS.md)
- OSS bootstrap + stranger docs: WHO-176, WHO-175, [SETUP.md](../../docs/SETUP.md)
- Security review for **self-host**: [SECURITY_REVIEW.md](../../docs/SECURITY_REVIEW.md) (hosted Stripe still N/A)
- Marketing site + pricing UI in repo: WHO-134, WHO-181 (`apps/www`)

## Operator leftover (not the default queue)

HomeHub parallel on `home.whobrey.me` and droplet import soak remain operator-run — [CUTOVER.md](../../deploy/CUTOVER.md). Do not block launch work on that retirement.
