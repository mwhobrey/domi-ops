# ADR 003: Hosted database architecture (Starter RLS + Family routing)

| Field | Value |
|-------|-------|
| **Status** | Accepted (pending Mike sign-off on launch-day tier scope) |
| **Date** | 2026-07-08 |
| **Linear** | [WHO-177](https://linear.app/mikewhob-whome/issue/WHO-177) · Epic [WHO-193](https://linear.app/mikewhob-whome/issue/WHO-193) |
| **Related** | [ADR 001](./001-public-launch-scope.md), [WHO-178](https://linear.app/mikewhob-whome/issue/WHO-178), [WHO-195](https://linear.app/mikewhob-whome/issue/WHO-195) |

## Context

Domi Ops today runs **one household per Postgres instance** (`DEPLOYMENT_MODE=single`). API handlers scope queries with `auth.householdId` from the session — sufficient for self-host but **not defense-in-depth** for multi-tenant hosted.

Hosted v1 targets two product tiers ([ADR 001](./001-public-launch-scope.md)):

| Tier | `households.tier` | Isolation model |
|------|-------------------|-----------------|
| **Hosted Starter** | `hosted_starter` | Shared Postgres + **RLS** |
| **Hosted Family** | `hosted_dedicated` | Dedicated Postgres per household (e.g. Neon project) |

Schema already has `deployment_tier` enum, `dedicated_db_ref`, `storage_quota_bytes`. No RLS policies, no subscription/entitlement tables, no per-request DB tenant context.

**Constraints:**

- Same codebase for self-host and hosted — no forked API routes per tier.
- Drizzle ORM + `postgres.js` — no Prisma middleware.
- Worker (BullMQ) runs household-scoped jobs — must set tenant context too.
- S3 keys already include `householdId` in paths — object store is out of Postgres RLS scope but must stay prefix-scoped in API.

## Decision

### 1. Launch-day tier scope: **Starter first**

Ship **Hosted Starter** (shared Postgres + RLS) at public launch. **Family** (dedicated DB per household) ships as a **paid upgrade path** with schema and routing hooks in place (`dedicated_db_ref`), but Neon provisioning automation can follow in a fast-follow release if schedule is tight.

**Rationale:** RLS on one database is one engineering surface. Per-household Neon projects add provisioning, billing linkage, connection pool explosion, and migration orchestration — high risk for day-one launch.

### 2. Defense in depth: API scoping **and** RLS

Keep existing `auth.householdId` filters in Hono routes. Add Postgres RLS as a **second line** when `DEPLOYMENT_MODE=shared`.

Self-host (`single`): RLS policies may be installed but are **not relied upon** — API scoping remains the guarantee. Migration runner uses a role with `BYPASSRLS`.

### 3. Tenant context via Postgres session variable

Use a custom setting per transaction:

```sql
SET LOCAL app.current_household_id = '<uuid>';
```

- **`SET LOCAL`** — scoped to the current transaction; safe with connection pooling (PgBouncer transaction mode, `postgres.js` transactions).
- RLS policies compare `household_id` columns to `current_setting('app.current_household_id', true)::uuid`.
- Missing setting → policies deny all rows (fail closed).

**API:** After `resolveAuthContext`, wrap route DB work in `withHouseholdContext(db, auth.householdId, fn)`.

**Worker:** Job payload includes `householdId`; worker sets context before handler runs.

**Migrations / CLI:** Use migration role with `BYPASSRLS` or omit context (superuser).

### 4. RLS table coverage

Enable RLS on every table with a `household_id` column (or junction tables reachable only through household-scoped parents). Approximate scope: **~40+ tables** across `core`, `school`, `calendar`, `drive`, `health`, `notifications`, `push`.

**Excluded from RLS** (global / auth):

- `users`, `ba_*` (Better Auth) — scoped via `household_members` join, not direct `household_id`
- `import_records` — self-host import only today; hosted: either RLS by household or disable import on hosted v1
- Stripe webhook dedupe / subscription tables — no `household_id` on event log; access via service role only

**Policy pattern (example):**

```sql
CREATE POLICY household_isolation ON notes
  USING (household_id = current_setting('app.current_household_id', true)::uuid);
```

Tables with visibility rules (notes `private`, health shares) keep **existing API logic**; RLS enforces household boundary only, not member-level visibility.

### 5. Hosted Family (dedicated DB) routing

When `households.tier = hosted_dedicated` and `dedicated_db_ref` is set:

- `dedicated_db_ref` stores an encrypted connection string reference (or Neon project ID resolved to URL at runtime).
- `createDb()` selects pool by household — **connection per dedicated household**, cached in LRU with TTL.
- RLS on dedicated DBs is **optional** (single household per DB) — can skip RLS on Family DBs for simplicity; isolation is physical.
- Schema migrations run **per dedicated DB** on provision (same migration files as shared).

**Phase 2 implementation** — not required for Starter launch.

### 6. Connection pooling

| Environment | Recommendation |
|-------------|----------------|
| **Starter (shared)** | PgBouncer in transaction mode **or** `postgres.js` `{ max: N }` with `SET LOCAL` inside explicit transactions |
| **Family** | Neon serverless driver or small pool per active dedicated DB |
| **Self-host** | Current single `DATABASE_URL` pool unchanged |

Do **not** use session-level `SET` without `LOCAL` — leaks tenant across pooled connections.

### 7. Entitlements schema (companion to isolation)

Add `household_subscriptions` ([WHO-194](https://linear.app/mikewhob-whome/issue/WHO-194)):

| Column | Purpose |
|--------|---------|
| `household_id` | FK, unique |
| `modules_entitled` | JSON array — ceiling for Settings toggles |
| `stripe_customer_id`, `stripe_subscription_id` | Billing linkage |
| `status` | `trialing` \| `active` \| `past_due` \| `canceled` |
| `trial_ends_at` | Nullable |

Hosted: `modules_enabled ⊆ modules_entitled`. Self-host: `modules_entitled` null / ignored.

### 8. S3 / MinIO isolation

Not covered by Postgres RLS. Continue server-generated keys under `drive/{householdId}/…` and `imports/{householdId}/…`. API presign grants bind `householdId` in HMAC token (existing). Audit any route that accepts raw S3 keys from clients.

### 9. Local development ([WHO-198](https://linear.app/mikewhob-whome/issue/WHO-198))

`docker-compose.hosted.yml` overlay:

- `DEPLOYMENT_MODE=shared`
- Seed **two households** with distinct owners
- Run WHO-197 leak tests locally

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| API-only scoping (no RLS) | One missed `where` clause = cross-tenant leak; unacceptable for hosted |
| Schema-per-tenant | Migration explosion; ops nightmare at Starter scale |
| Family-only (no Starter) | Higher COGS; blocks entry hosted tier in ADR 001 |
| Citus / sharding | Overkill for v1 household count |

## Consequences

### Positive

- Starter tier is implementable with one Postgres cluster (DO Managed Postgres or similar).
- `SET LOCAL` works with existing `postgres.js` + Drizzle transaction patterns.
- Family upgrade path is explicit without blocking Starter launch.
- Worker and API share one context helper.

### Negative / cost

- Every new table with `household_id` needs an RLS policy in the same migration ([WHO-195](https://linear.app/mikewhob-whome/issue/WHO-195)).
- Integration tests must run in `shared` mode ([WHO-197](https://linear.app/mikewhob-whome/issue/WHO-197)).
- Drizzle migrations must use a `BYPASSRLS` role — document in runbook.
- Family tier adds connection management complexity when enabled.

## Implementation sequence

See [WHO-193](https://linear.app/mikewhob-whome/issue/WHO-193) epic:

1. **WHO-194** — subscription schema
2. **WHO-195** — RLS migration
3. **WHO-196** — `withHouseholdContext` wrapper
4. **WHO-178** — config + entitlement enforcement wiring
5. **WHO-198** — hosted compose + seed
6. **WHO-197** — leak test matrix
7. **M5** — WHO-185 → WHO-199 → WHO-179 → WHO-184 → WHO-186

## Open questions for Mike

| # | Question | Default if no answer |
|---|----------|----------------------|
| 1 | Starter-only at launch? | **Yes** — Family fast-follow |
| 2 | Hosted Postgres provider (DO Managed vs Neon for Starter) | DO Managed Postgres (same as self-host ops familiarity) |
| 3 | Disable HomeHub import on hosted? | **Yes** for v1 — import is self-host migration path |
| 4 | PgBouncer in hosted compose? | Yes for Starter prod; optional in dev compose |

## Sign-off

- [ ] Mike confirms Starter-only launch scope
- [ ] Mike confirms hosted Postgres provider
