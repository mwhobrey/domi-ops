# Launch state (OSS + hosted)

*Prioritize this over new module work unless a dogfood or beta bug is blocking daily use.*

## Where things stand

The **OSS repo is public** (MIT, `mwhobrey/domi-ops`, `main`, GHCR images published on every merge — WHO-174 done). The **marketing site is live** at `domi-ops.com`. The **hosted Starter private beta is live** at `app.domi-ops.com` (`DEPLOYMENT_MODE=shared`, real DigitalOcean split infra, production Stripe with checkout enabled), and one invited tester is going through the real marketing → checkout → `/setup` onboarding path.

Policy source: [ADR 001](../../docs/adr/001-public-launch-scope.md) (OSS + hosted as one product, one codebase) and [ADR 003](../../docs/adr/003-hosted-db-architecture.md) (split infra, Starter now, Family later).

| Track | Shape |
|-------|-------|
| **OSS** | MIT, Docker Compose, full module bundle, `DEPLOYMENT_MODE=single`. Public. |
| **Hosted Starter** | `DEPLOYMENT_MODE=shared` + RLS. Private beta live. Public opening is what's left. |
| **Hosted Family** | Dedicated DB per household. Unbuilt (ADR 003 Phase 2). "Coming soon." |
| **Same codebase** | No paywalled modules in git; hosted monetizes via entitlements + Drive quota. |

Pricing: [PRICING_TIERS.md](../../docs/marketing/PRICING_TIERS.md) — $12/mo / $120/yr, 14-day trial (card required), 25 GB Drive, all modules.

## Deployments

- **Dogfood:** `https://whome.whobrey.me`, single-tenant, operator-run (`deploy/update-prod.sh`). Local QA phases 0–5 pass — [06_DOGFOOD_TEST_PHASES.md](./06_DOGFOOD_TEST_PHASES.md).
- **Hosted beta:** `app.domi-ops.com` + `domi-ops.com`, split infra (compute droplet + DO Managed Postgres + DO Spaces, ~$32/mo). Deploy via `deploy/deploy-hosted.sh` on the droplet after each merge. **Migrations run first, via the admin connection** — the app's `domi_ops_app` role has no DDL rights, so the deploy script's pending-migrations check aborts until an admin `db:migrate` has run. Full provisioning + ops: [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md), [deploy/HOSTED_OPS.md](../../deploy/HOSTED_OPS.md).

## What's left

1. **Watch beta feedback.** The tester is live; act on what comes back.
2. **WHO-186** — enforce `household_subscriptions.status` (`past_due` / `canceled`) on module entitlements. Today `getHouseholdModuleContext` only reads the `modules_entitled` ceiling; status is surfaced in Settings UI but doesn't gate anything.
3. **Public hosted opening** (WHO-187 go/no-go → announcement): open signup (currently `/auth/sign-up/*` is hard-blocked on hosted — WHO-248), community channels, `CODE_OF_CONDUCT.md` / `SECURITY.md` / issue templates audit, post-launch support runbook.
4. **Real brand assets** — `apps/www` still renders "Domi Ops" as plain text, no `favicon.ico`, no OG image.

## Shipped (do not redo)

- **M3 hosted foundation:** RLS (`0038`/`0039`), tenant middleware, entitlements ceiling, `docker-compose.hosted.yml` + seed + leak tests — [HOSTED_RLS.md](../../docs/HOSTED_RLS.md), [HOSTED_TENANT_TESTS.md](../../docs/HOSTED_TENANT_TESTS.md). `npm run test:hosted` is a required check on `main` (WHO-249).
- **M5 billing:** Stripe SKUs, `POST /api/billing/checkout` (plain HTML form, `allow_promotion_codes`), webhook → `stripe_events` idempotency (`0054`) → household + subscription provisioning, `/setup?session_id=` wizard (WHO-184/185/199). Checkout is **on** in beta (`NEXT_PUBLIC_HOSTED_CHECKOUT_ENABLED=true`, live keys).
- **Hosted onboarding:** Google-first sign-in wired end-to-end (WHO-277/278/279) — no-household sessions route to `/pricing`, `/hosted-setup/complete` attaches an orphan account (signed-in-as check), `apps/web` has real error / not-found pages.
- **OSS readiness:** bootstrap + stranger docs (WHO-175/176, [SETUP.md](../../docs/SETUP.md)), self-host security review ([SECURITY_REVIEW.md](../../docs/SECURITY_REVIEW.md)), MIT license, marketing site + legal pages (WHO-134/181/182).

## RLS bootstrap — the lesson that cost the most (2026-08-25/27)

The Stripe webhook and `/hosted-setup` wizard create `households` / `household_subscriptions` rows *before* any `household_id` is known, which `household_isolation` RLS can never satisfy. Two compounding bugs, both found by running the flow against a real RLS-enforced `domi_ops_app` connection:

1. `household_subscriptions` had no `system_bootstrap` policy — added in `0056_billing_system_bootstrap.sql`.
2. `billing.ts` didn't wrap its pre-household queries in `withSystemContext` — now does (webhook handlers, `/hosted-setup/validate`, `/hosted-setup/complete`).

Regression-locked in `packages/db/src/billing-system-bootstrap.integration.test.ts` (`test:hosted`).

**Operational rule that came out of it:** the API image's entrypoint runs `migrate.js` on every boot, but the hosted `domi_ops_app` role can't do DDL (or even `CREATE SCHEMA IF NOT EXISTS` on an existing schema — Postgres permission-checks it regardless). So `docker-compose.hosted-prod.yml` overrides the entrypoint to skip migrations, and **every deploy with a new migration runs `db:migrate` with the admin connection first, then restarts containers.** A migration that adds tables also needs `create-hosted-app-role.mjs` re-run (its grants only cover tables that exist when it runs). Details: [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md) §1.

## Operator leftover (not the default queue)

HomeHub parallel on `home.whobrey.me` + droplet import soak — [CUTOVER.md](../../deploy/CUTOVER.md). Don't block launch work on that retirement.
