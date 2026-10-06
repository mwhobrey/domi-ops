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

Every table with RLS also needs a `worker_scan` policy if any cross-tenant worker scan reads it; without one the scan sees the table as empty and nothing fails loudly (this is how `health_member_acl` hid every caregiver from the reminder worker, WHO-403). The calendar, chore, chore digest, school, budget, drive quota and health reminder scans no longer scan cross-tenant (WHO-403, WHO-404): a tick enqueues one job per household (`packages/calendar-sync/src/household-scan-fanout.ts`) and each job runs under `withHouseholdContext`, so `health_member_acl` deliberately has no `worker_scan` policy. The ticks themselves still read cross-tenant, and so do `myallyfile.sync.scan` (already isolated per link) and the Google calendar jobs. `packages/db/src/rls-worker-scan-coverage.integration.test.ts` fails if a table lacks one and is not on its explicit "never scanned" list.

Later migrations add their own tables with the same two policies (`household_isolation` + `worker_scan`). `0085_health_checks` adds nine health check tables; see [HOSTED_TENANT_TESTS.md](./HOSTED_TENANT_TESTS.md).

**Pharmacies, supply and organizers (WHO-413, WHO-414, WHO-432, WHO-434).** Sixteen more tables, each with `household_isolation` (a direct `household_id` match, or an `EXISTS` join to the plan or medication that owns the row):

| Migration | Tables |
|-----------|--------|
| `0087_health_supply` | `health_pharmacies`, `health_medication_supply`, `health_medication_supply_revisions`, `health_medication_refill_events`, `health_supply_settings` |
| `0088_health_organizers` | `health_organizer_plans`, `health_organizer_compartments`, `health_organizer_time_map`, `health_organizer_plan_caregivers`, `health_organizer_occurrences`, `health_organizer_occurrence_events`, `health_organizer_sessions`, `health_organizer_session_fills`, `health_medication_dose_quantities` |
| `0090_health_supply_reminders` | `health_supply_fill_reminder_sent`, `health_supply_refill_reminder_sent` |

Only **`health_organizer_plans`** and **`health_medication_supply`** keep a `worker_scan` policy. The fill and refill reminder job (`health.supply.reminder.household`) runs per household under `withHouseholdContext`, like the dose and check scans, and reads and writes everything else there. What reads across households is the scheduler's tick (`fanOutSupplyReminderScans`), which only asks which households have a plan or an estimate. Migrations 0087, 0088 and 0090 had given every table a `worker_scan` policy out of habit; `0091_health_supply_least_privilege` dropped it from the other fourteen, and they are on the "never scanned" list in `rls-worker-scan-coverage.integration.test.ts`. Do not add one back: a worker-scan transaction would then see every household's pharmacies, supply history and reminders. Test coverage: [HOSTED_TENANT_TESTS.md](./HOSTED_TENANT_TESTS.md#pharmacies-supply-organizers-and-their-reminders-who-413-to-who-434).

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
