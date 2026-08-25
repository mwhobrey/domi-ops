# Hosted tenant isolation test matrix (WHO-197)

Prove cross-household leakage is impossible when `DEPLOYMENT_MODE=shared` and RLS policies (`0038`/`0039`) are applied.

## Prerequisites

1. Postgres with migrations applied (`npm run db:migrate`).
2. Hosted QA seed (`npm run db:seed-hosted-qa`) — creates **Alpha** and **Beta** households with distinct notes.
3. RLS-enforced app role (`npm run db:create-app-role`) — `domi_ops_app` is non-superuser (`NOBYPASSRLS`); required because dev `domi_ops` bypasses RLS.
4. `HOSTED_TEST_DATABASE_URL=postgresql://domi_ops_app:domi_ops_app@localhost:5432/domi_ops` (or set `DATABASE_URL` to the app role for `test:hosted`).

```bash
docker compose -f docker-compose.yml -f docker-compose.hosted.yml up -d postgres
npm run db:migrate
npm run db:seed-hosted-qa
npm run db:create-app-role
HOSTED_TEST_DATABASE_URL=postgresql://domi_ops_app:domi_ops_app@localhost:5432/domi_ops npm run test:hosted
```

## Automated matrix (`packages/db/src/tenant-isolation.integration.test.ts`)

| Case | Expectation |
|------|-------------|
| Tenant A reads notes | Sees only Alpha note (`alpha-secret-note`) |
| Tenant B reads notes | Sees only Beta note (`beta-secret-note`) |
| Tenant A inserts note | Visible under A; invisible to B |
| Worker scan context | Can read households across tenants (trusted process) |
| System context | Bootstrap path can insert households (greenfield only) |

## Billing bootstrap matrix (`packages/db/src/billing-system-bootstrap.integration.test.ts`)

Added 2026-08-25 after the Stripe webhook's household/`household_subscriptions` provisioning was found to have no working RLS path under `domi_ops_app` (migration `0056_billing_system_bootstrap.sql`, `docs/HOSTED_RLS.md`).

| Case | Expectation |
|------|-------------|
| Household insert with no RLS context | Rejected — proves RLS is actually enforced, not just installed |
| Household + `household_subscriptions` insert inside `withSystemContext` | Succeeds |
| Read `household_subscriptions` by `stripeCustomerId` inside `withSystemContext` | Finds the row (same shape as `hosted-setup/validate`) |

## Manual API checks (after `dev:hosted` stack)

1. Log in as `alpha@hosted-qa.domi-ops.test` — `/api/core/notes` returns one note.
2. Log in as `beta@hosted-qa.domi-ops.test` — different note; no alpha title in list.
3. PATCH settings with module above entitlement ceiling → `400 invalid_modules`.
4. Authenticated user without household membership on hosted → `500 tenant_context_required`.

## CI

GitHub Actions job `test-hosted` in `.github/workflows/ci.yml`:

1. Postgres 16 service container (`domi_ops` / `domi_ops` / `domi_ops`)
2. `npm run build`, `npm run migrate:run -w @domi-ops/db`, `npm run seed:hosted-qa -w @domi-ops/db`
3. `npm run db:create-app-role` (non-superuser `domi_ops_app` for RLS-enforced tests)
4. `npm run test:hosted` with `HOSTED_TEST_DATABASE_URL=postgresql://domi_ops_app:domi_ops_app@localhost:5432/domi_ops` — runs both `tenant-isolation.integration.test.ts` and `billing-system-bootstrap.integration.test.ts`

Runs on push/PR to `master`/`main` alongside the main CI build job.

## Security review linkage

Results feed [WHO-172](https://linear.app/mikewhob-whome/issue/WHO-172) hosted tenant isolation section after WHO-197 passes locally.
