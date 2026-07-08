# Hosted tenant isolation test matrix (WHO-197)

Prove cross-household leakage is impossible when `DEPLOYMENT_MODE=shared` and RLS policies (`0038`/`0039`) are applied.

## Prerequisites

1. Postgres with migrations applied (`npm run db:migrate`).
2. Hosted QA seed (`npm run db:seed-hosted-qa`) — creates **Alpha** and **Beta** households with distinct notes.
3. `HOSTED_TEST_DATABASE_URL` or `DATABASE_URL` pointing at that database.

```bash
docker compose -f docker-compose.yml -f docker-compose.hosted.yml up -d postgres
npm run db:migrate
npm run db:seed-hosted-qa
HOSTED_TEST_DATABASE_URL=postgresql://domi_ops:domi_ops@localhost:5432/domi_ops npm run test:hosted
```

## Automated matrix (`packages/db/src/tenant-isolation.integration.test.ts`)

| Case | Expectation |
|------|-------------|
| Tenant A reads notes | Sees only Alpha note (`alpha-secret-note`) |
| Tenant B reads notes | Sees only Beta note (`beta-secret-note`) |
| Tenant A inserts note | Visible under A; invisible to B |
| Worker scan context | Can read households across tenants (trusted process) |
| System context | Bootstrap path can insert households (greenfield only) |

## Manual API checks (after `dev:hosted` stack)

1. Log in as `alpha@hosted-qa.domi-ops.test` — `/api/core/notes` returns one note.
2. Log in as `beta@hosted-qa.domi-ops.test` — different note; no alpha title in list.
3. PATCH settings with module above entitlement ceiling → `400 invalid_modules`.
4. Authenticated user without household membership on hosted → `500 tenant_context_required`.

## CI (future)

Run `npm run test:hosted` in GitHub Actions with a service Postgres container, migrations, and seed — gated on `HOSTED_TEST_DATABASE_URL` in workflow env.

## Security review linkage

Results feed [WHO-172](https://linear.app/mikewhob-whome/issue/WHO-172) hosted tenant isolation section after WHO-197 passes locally.
