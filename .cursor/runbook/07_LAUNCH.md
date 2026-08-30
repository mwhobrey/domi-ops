# Public launch (OSS + hosted)

*Prioritize this file over module polish unless a household dogfood bug is blocking daily use.*

## Policy

**Near-simultaneous public launch:** OSS self-host and Domi Ops Hosted Starter ship together. Repo and GHCR stay private until both tracks pass go/no-go ([WHO-187](https://linear.app/mikewhob-whome/issue/WHO-187)). Then public flip ([WHO-174](https://linear.app/mikewhob-whome/issue/WHO-174)).

Source of truth: [ADR 001](../../docs/adr/001-public-launch-scope.md). Do **not** open hosted signup or the public repo first.

**Amendment (2026-08-24, Mike):** a scoped **private beta** now runs *ahead of* the OSS repo flip — see below. This does not change the ADR 001 "single launch moment" principle for the *public* flip; it adds one invited external tester before that moment.

## Private beta (pre-OSS-flip)

**Goal:** real signal from one outside tester going through the actual marketing → checkout → onboarding path, before committing to the public repo flip.

**Scope — what goes live:**
- `domi-ops.com` DNS cutover + marketing site (`apps/www`) deployed for real.
- `app.domi-ops.com` hosted (`DEPLOYMENT_MODE=shared`) deployed for the first time — does not exist anywhere yet as of 2026-08-24.
- **Live** Stripe keys/products/prices, with a 100%-off promotion code for the tester as a thank-you (`allow_promotion_codes` on Checkout).
- Repo and GHCR images **stay private** — this is not the OSS flip. Hosted public signup stays hard-blocked in code (WHO-248); the beta tester is provisioned exclusively through the Stripe checkout → webhook → `/hosted-setup` path, which does not touch the blocked `/auth/sign-up` route (confirmed by code read, 2026-08-24).

**Decision (2026-08-24, Mike):** The beta tester goes on the **real shared Hosted Starter instance**, not a one-off self-host droplet — they don't care about internals, and this is the chance to build and validate the actual production environment (not throwaway infra). Split-infra architecture per [ADR 003](../../docs/adr/003-hosted-db-architecture.md): compute droplet (API/worker/web/Redis, ~$12/mo) + DigitalOcean Managed Postgres (~$15/mo, RLS) + DigitalOcean Spaces (~$5/mo) — **~$32/mo total**, matching the fixed-infra number already budgeted in `PRICING_TIERS.md`. Full provisioning steps: [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md), compute layer in `docker-compose.hosted-prod.yml` + `.env.hosted-prod.example` (repo root).

Super-admin module control panel: **not needed**, dropped from scope. Household-side module toggle already exists (`Settings → Modules`); the single all-modules Starter SKU means the Stripe webhook already grants everything automatically (`ALL_MODULES` in `apps/api/src/routes/billing.ts`) — no manual override tool required at this scale.

**Must-do before beta handoff:**
- [x] Stripe Checkout entry point — `POST /api/billing/checkout` (`apps/api/src/routes/billing.ts`) creates the session with `allow_promotion_codes: true`; pricing page posts to it via a plain HTML form, no client JS, no CORS involved (top-level navigation). Gated behind `NEXT_PUBLIC_HOSTED_CHECKOUT_ENABLED` (default false → "Coming soon"). Post-checkout return flow (`/setup?session_id=...`) was already built and unchanged.
- [ ] Stripe dashboard: live Product/Price, 100%-off coupon + promotion code, webhook registered at `https://app.domi-ops.com/api/billing/webhook`, keys in prod env. Checklist: [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md) §6.
- [ ] Provision the real shared instance — DO Managed Postgres, DO Spaces, droplet, Caddy, DNS. Checklist: [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md) §1–5. (Operator-run, needs DO/Stripe account access.)
- [x] Marketing site content pass — reviewed 2026-08-24. Found: positioning skews "homeschool-first" vs. README's general-household framing (flagged, not changed — confirm intentional); self-host CTAs pointed at the private GitHub repo (would 404 publicly) — fixed, now gated behind `NEXT_PUBLIC_OSS_REPO_PUBLIC` env flag (default false → "Coming soon" on all three self-host links: hero, nav, footer, pricing table). Flip to `true` only after WHO-174.
- [ ] Real logo / favicon / OG image — still none anywhere in `apps/www` (`Domi Ops` renders as plain text in the header, no `favicon.ico`, no social preview image).
- [x] First-login onboarding tutorial — **built in-app**: `apps/web/src/components/OnboardingChecklist.tsx`, a dismissible checklist card on the dashboard, role-aware (owner/admin vs. member steps). Persistence is **server-side** (`household_members.onboarding_*`, migration `0055_onboarding_checklist.sql`, `GET`/`PATCH /api/core/onboarding`) so progress follows the person across whatever device or platform they're on — first pass used `localStorage` and got replaced before shipping once it didn't hold up cross-platform. Content source: [docs/ONBOARDING_GUIDE.md](../../docs/ONBOARDING_GUIDE.md).
- [ ] Carry over from security review before exposing this publicly: `nodemailer` CVE bump (flagged as blocking public repo, applies here too since real email may be involved).

**Found and fixed during a gap-review pass (2026-08-25) — this would have silently broken the beta tester's signup:** the Stripe webhook and hosted-setup wizard (`apps/api/src/routes/billing.ts`) create `households` / `household_subscriptions` rows before any `household_id` is known — RLS's normal `household_isolation` policy can never pass for that, and nothing in the code called the `withSystemContext` helper that exists precisely for this case. Two compounding issues, both real, both confirmed by actually running the flow against a live RLS-enforced `domi_ops_app` connection (not just read from code):

1. `household_subscriptions` never got a `system_bootstrap` policy in 0039 (only `households`/`household_members` did) — fixed in `0056_billing_system_bootstrap.sql`.
2. `billing.ts` itself never wrapped its household/subscription queries in any context helper — fixed by wrapping the webhook's event handlers, `/hosted-setup/validate`, and `/hosted-setup/complete` in `withSystemContext`.

Also caught in the same pass: the API container's Docker `ENTRYPOINT` runs migrations **unconditionally on every boot**, regardless of compose file — with the app's `DATABASE_URL` pointed at the restricted `domi_ops_app` role (necessary for RLS to mean anything at runtime — see "why not just run as admin" in [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md) §1), that role had no access to the schema Drizzle tracks migrations in, which would have crash-looped the container on first boot. Fixed: `create-hosted-app-role.mjs` now grants `USAGE`/`SELECT` on the `drizzle` schema too, and the setup doc now states the operational rule (migrate as admin *before* every deploy, not after).

**Verified for real, not just typechecked:** spun up Postgres locally, ran migrations, created `domi_ops_app`, and proved both the failure mode and the fix empirically — an unwrapped `households` insert under `domi_ops_app` throws (RLS actually enforced), the same insert plus a `household_subscriptions` insert succeeds inside `withSystemContext`, and a `stripeCustomerId` read-back works (the exact shape `hosted-setup/validate` needs). Promoted into a permanent regression test — `packages/db/src/billing-system-bootstrap.integration.test.ts` — now part of `npm run test:hosted`, so this can't regress silently again; full `test:hosted` run (5 tests, tenant-isolation + billing bootstrap) passed clean.

Also fixed in the same pass: pricing page had no way to actually choose the annual plan despite `STRIPE_PRICE_STARTER_ANNUAL` existing (`apps/www/src/lib/pricing-display.ts` — now offers both), `/login?hosted=1` had no welcome state after checkout (small banner added), and `docker-compose.marketing.yml`'s usage comment only mentioned the self-host base compose file, not the new hosted one.

**Verified 2026-08-25:** `npm run typecheck`, `npm run build`, `npm run test` (351 tests) all pass. `npm run test:hosted` (5 tests) run for real against a live Postgres container, not just typechecked.

**Explicitly not required for the beta** (deferred to the real public flip): public repo/GHCR flip (WHO-174), open hosted public signup, WHO-186 subscription-status enforcement hardening (`past_due`/`canceled` gating — low risk for one comped household), issue templates / CODE_OF_CONDUCT / SECURITY.md, super-admin module control (see decision above), Hosted Family / dedicated-DB routing (unbuilt, Phase 2 per ADR 003 — irrelevant to Starter).

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

## Marketing deploy status

**Superseded by the private beta above (2026-08-24):** `apps/www` is now planned for real deployment ahead of the OSS flip, not held back. DNS cutover for `domi-ops.com` — [DNS_CUTOVER.md](../../docs/marketing/DNS_CUTOVER.md) — happens as part of [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md) §5.

Legal copy is in repo ([WHO-182](https://linear.app/mikewhob-whome/issue/WHO-182)): shared `@domi-ops/marketing-ui` content on www and app. Operator is DBA Domi Ops (sole proprietor). Contact `privacy@domi-ops.com` (mailbox not necessarily live). Not lawyer-reviewed.

Checkout stays off until Stripe: `getPricingDisplay()` in `apps/www/src/lib/pricing-display.ts` reads `NEXT_PUBLIC_HOSTED_CHECKOUT_ENABLED` (env-driven, default `false`) — see `.env.hosted-prod.example`.

Deploy recipe: `docker-compose.hosted-prod.yml` (compute — API/worker/web/Redis, split-infra per ADR 003) + `docker-compose.marketing.yml` (www) + `deploy/Caddyfile.domi-ops.example` (minus the `/s3/*` MinIO block — Drive uses DO Spaces directly). Full steps: [deploy/HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md).

## Workstreams (order)

Do not start the OSS public flip before hosted billing + shared-mode staging.

```
M5 billing (see below)
  → shared-mode staging + npm run test:hosted
marketing deploy + DNS (www; checkout still off)
WHO-174 public repo + GHCR
  → WHO-187 go/no-go (both tracks)
```

**M5 order** ([ADR 003](../../docs/adr/003-hosted-db-architecture.md)):

1. [WHO-185](https://linear.app/mikewhob-whome/issue/WHO-185) — Stripe SKUs (IDs into `PRICING_TIERS.md` + env)
2. [WHO-199](https://linear.app/mikewhob-whome/issue/WHO-199) / [WHO-179](https://linear.app/mikewhob-whome/issue/WHO-179) — webhook + household provision
3. [WHO-184](https://linear.app/mikewhob-whome/issue/WHO-184) — hosted setup wizard (not the single-tenant `SETUP_TOKEN` path)
4. [WHO-186](https://linear.app/mikewhob-whome/issue/WHO-186) — Drive quota + module ceiling **and subscription status** (`trialing` / `active` / `past_due` / `canceled` are schema-only today — `packages/db/src/schema/billing.ts`; `getHouseholdModuleContext` does not read `status`)

Hosted ops notes: [HOSTED_OPS.md](../../deploy/HOSTED_OPS.md). Leak matrix: [HOSTED_TENANT_TESTS.md](../../docs/HOSTED_TENANT_TESTS.md) — `npm run test:hosted` **is now in CI** (`test-hosted` job, stabilized 2026-08-24, WHO-249).

## What is already done (do not redo)

- M3 hosted foundation: RLS `0038`/`0039`, tenant middleware, entitlements ceiling, `docker-compose.hosted.yml`, seed, leak tests — [01_ARCHITECTURE.md](./01_ARCHITECTURE.md), [HOSTED_RLS.md](../../docs/HOSTED_RLS.md)
- OSS bootstrap + stranger docs: WHO-176, WHO-175, [SETUP.md](../../docs/SETUP.md)
- Security review for **self-host**: [SECURITY_REVIEW.md](../../docs/SECURITY_REVIEW.md) (hosted Stripe still N/A)
- Marketing site + pricing UI in repo: WHO-134, WHO-181 (`apps/www`)
- Legal pages: WHO-182 — shared Privacy/Terms on www + app (`packages/marketing-ui/src/legal.tsx`)

## Operator leftover (not the default queue)

HomeHub parallel on `home.whobrey.me` and droplet import soak remain operator-run — [CUTOVER.md](../../deploy/CUTOVER.md). Do not block launch work on that retirement.
