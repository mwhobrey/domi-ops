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

## Health checks matrix (`packages/db/src/health-checks-isolation.integration.test.ts`)

Added with the scheduled health checks tables (WHO-379/380, migration `0085_health_checks`: `health_checks`, `health_check_groups`, `health_check_group_members`, `health_check_group_shares`, `health_check_shares`, `health_check_pauses`, `health_check_logs`, `health_check_reminder_sent`, `health_check_group_reminder_sent`). Seeds its own rows in Alpha and Beta (plus a second Alpha member) and deletes them afterwards.

| Case | Expectation |
|------|-------------|
| Alpha / Beta read checks and groups | Each sees only its own |
| Child tables (logs, pauses, shares, group members, group shares) | Each tenant gets back exactly its own rows (asserted by id, not just count); asking for only the other tenant's ids returns nothing |
| No household context | Zero rows |
| Cross-tenant insert (check, log, reminder-sent) | Rejected by RLS (`42501`); an UPDATE aimed at the other tenant's row matches nothing |
| Links to another household's records | A log pointing at the other tenant's event, a check or group shared with the other tenant's member, and a group containing the other tenant's check are all rejected by RLS; the same log with the tenant's own event is allowed (positive control) |
| Group holds only one member's checks | A group cannot contain a check of a different member, even in the same household (composite foreign key, `23503`) |
| Worker scan context | Sees both tenants |
| DB constraints | `medication` event type and `prn`/`otc` schedule kinds (checks and groups) are rejected by CHECK (`23514`); a second log for the same check and instant is rejected (`23505`) |

These only mean anything as the non-superuser `domi_ops_app` role; as a superuser the four isolation cases fail by design.

## Health checks API matrix (`apps/api/src/routes/health-checks.integration.test.ts`)

WHO-382. Drives the real `/api/health/checks` and `/api/health/check-groups` handlers through the real tenant middleware (a fake-auth parent app sets `auth` from an `x-as` header), so every request runs in a household-scoped RLS transaction. Seeds its own households and deletes them afterwards.

| Case | Expectation |
|------|-------------|
| Who sees a private check | Creator, the subject, and `events` read/write grantees. Not an admin without a grant, not a stranger, not another household. List and single GET always agree |
| Write by someone who cannot see it | 404 (existence is not revealed), never 403 |
| Household-visible check | Everyone sees it; only the creator or an `events` writer can PATCH/DELETE (WHO-339) |
| Shares | Household members only (other households and the creator are filtered out), read-only, hidden from non-editors, cleared when made household-visible |
| Create | `events` write on the member; member must belong to the caller's household (404 otherwise) |
| Validation | `medication` type, `prn`/`otc`, empty vitals template, bad dates, oversized names, non-boolean flags all 400 with a specific code |
| Immutable fields | `memberId` and `eventType` cannot change after create |
| Pause / resume | `enabled` flips open and close pause periods, once per change |
| Soft delete | `deleted_at` set, disabled, hidden, removed from groups; a second delete is 404 |
| Groups | Only the group member's checks (400 `member_mismatch`); several groups per check; viewers only see member checks they may see; same write rules as checks |
| Module / auth | 403 without the health module; 401 unauthenticated |

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

Runs on push/PR to `main` alongside the main CI build job.

## Security review linkage

Results feed [WHO-172](https://linear.app/mikewhob-whome/issue/WHO-172) hosted tenant isolation section after WHO-197 passes locally.
