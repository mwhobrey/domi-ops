# Hosted RLS (Starter tier)

**Linear:** [WHO-195](https://linear.app/mikewhob-whome/issue/WHO-195) · [WHO-196](https://linear.app/mikewhob-whome/issue/WHO-196)

## Overview

When `DEPLOYMENT_MODE=shared`, Postgres enforces tenant isolation via Row Level Security. See [ADR 003](./adr/003-hosted-db-architecture.md).

Migration: `packages/db/drizzle/0038_rls_household_policies.sql` (regenerate: `npm run generate:rls -w @domi-ops/db`).

## Session variable

Each transaction must set:

```sql
SET LOCAL app.current_household_id = '<household-uuid>';
```

Implemented in `@domi-ops/db`:

| Helper | GUC | Use |
|--------|-----|-----|
| `withHouseholdContext` | `app.current_household_id` | API (tenant middleware) + household-scoped worker jobs |
| `withUserLookupContext` | `app.current_user_id` | Auth middleware membership lookup |
| `withSystemContext` | `app.system_access` | Greenfield bootstrap CLI; Stripe billing webhook + hosted-setup wizard (`apps/api/src/routes/billing.ts`) — provisions households/subscriptions before any `household_id` is known |
| `withWorkerScanContext` | `app.worker_scan` | Cross-tenant reminder/budget/digest scans |

API: `createScopedDb` + `createTenantMiddleware` — authenticated requests run inside one transaction with tenant context; route handlers use the scoped db proxy unchanged.

Migration `0039_rls_context_policies.sql` adds supplemental policies (auth lookup, bootstrap, worker scan). Regenerate: `npm run generate:rls-context -w @domi-ops/db`.

`0056_billing_system_bootstrap.sql` extends `system_bootstrap` to `household_subscriptions` — 0039 only covered `households`/`household_members`, which meant the billing webhook's `household_subscriptions` writes had no policy that could ever pass under the RLS-enforced app role. Caught by actually exercising the webhook path against `domi_ops_app` during hosted beta setup (2026-08-25), not by anything in CI — `test:hosted` only ran migrations/seed, never booted the app against the restricted role. Regression coverage: `packages/db/src/billing-system-bootstrap.integration.test.ts`, now in the `test:hosted` script.

Helper function: `app.tenant_household_id()` reads the same setting.

## Tables covered

**51 tables** with `household_isolation` policy — direct `household_id` match or `EXISTS` join to a parent row.

## Excluded (v1)

No RLS on auth / global identity tables (API must scope):

- `users`, `ba_sessions`, `ba_accounts`, `ba_verifications`
- `auth_sessions`, `oauth_accounts` (legacy)
- `push_subscriptions`

Revisit in [WHO-197](https://linear.app/mikewhob-whome/issue/WHO-197) leak test matrix.

## Operations

| Role | RLS |
|------|-----|
| Migration runner (superuser) | Bypasses RLS |
| Dev `domi_ops` Postgres user | Superuser in Docker — bypasses RLS until WHO-196 |
| Hosted app role (DO Managed) | **Must not** have `BYPASSRLS`; must set tenant context |

## Self-host (`DEPLOYMENT_MODE=single`)

RLS policies are installed but inactive for typical dev (superuser connection). API `auth.householdId` scoping remains the guarantee. WHO-196 will set context in all modes for consistency.
