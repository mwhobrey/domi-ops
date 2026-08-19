# Domi Ops hosted operations runbook (WHO-180)

Production operations for **Domi Ops hosted** (`DEPLOYMENT_MODE=shared` on `app.domi-ops.com`). Self-host single-tenant ops remain in [CUTOVER.md](./CUTOVER.md) and `.cursor/runbook/03_RULES_AND_STANDARDS.md`.

## Stack (Starter tier)

| Component | Role |
|-----------|------|
| Postgres (DO Managed or equivalent) | Shared DB + RLS (`0038`/`0039`) |
| Redis | BullMQ queues, OAuth state |
| MinIO / S3 | Per-household object keys (`drive/{householdId}/…`) |
| API + Worker | GHCR images (`ghcr.io/mwhobrey/domi-ops-*`) |
| Caddy | TLS termination → web + API |

PgBouncer in **transaction mode** for Starter prod (see ADR 003). Migrations run as a `BYPASSRLS` role — never as the app pool user.

## Health & monitoring

| Signal | Check |
|--------|--------|
| API liveness | `GET https://app.domi-ops.com/api/health` (or `/health` on API host) |
| Worker queue | Redis `LLEN` on `bull:domi-ops-sync:*` — alert on sustained growth |
| Failed jobs | Worker logs + BullMQ failed set; replay after root-cause |
| Postgres | Connections, disk, replication lag (managed provider dashboards) |
| S3 | Bucket size, 5xx rate on presigned PUT path |

## Backups

| Asset | Cadence | Restore notes |
|-------|---------|---------------|
| Postgres | Daily automated (provider) + pre-migration snapshot | Point-in-time to new cluster; re-run `db:migrate` if restoring older base |
| S3 / MinIO | Versioning or daily bucket sync | Keys are household-scoped; partial restore per prefix possible |
| Redis | **Ephemeral** — OAuth state, job queue | No user data restore required; workers reschedule scans |

## Incidents

### Bad deploy

1. Pin `DOMI_OPS_IMAGE_TAG` to last known-good SHA in compose/env.
2. `docker compose pull && docker compose up -d api worker web`.
3. Verify health + login smoke (WHO-187 checklist).

### Migration failure

1. Stop API/worker to prevent half-applied writers.
2. Restore Postgres snapshot **or** fix-forward migration on a branch.
3. Never run migrations as app user without `BYPASSRLS` on hosted.

### Suspected tenant leak

1. Stop traffic to API.
2. Run `npm run test:hosted` against prod read replica (read-only) or staging clone.
3. File incident; rotate `SESSION_SECRET` if session forgery suspected.

### Break-glass owner access (support/admin)

Use only when a hosted household owner cannot complete checkout setup/login and normal recovery fails.

1. Open incident ticket with household id, operator, reason, and expiration window.
2. Verify requestor identity through existing support verification policy.
3. Grant temporary access by running an operator-scoped recovery action (never by enabling global public signup):
   - preferred: recover specific owner account credentials/session for that household
   - fallback: create a temporary owner credential for the affected household only
4. Confirm owner can sign in and recover normal credentials.
5. Revoke temporary access immediately after recovery:
   - expire temporary credential/session
   - rotate any one-time token used
6. Post-incident audit log must include:
   - who executed access
   - exact command/procedure used
   - start/end timestamps
   - verification and revocation evidence

## Secret rotation

| Secret | Impact | Procedure |
|--------|--------|-----------|
| `SESSION_SECRET` | Invalidates all sessions | Rolling deploy with new secret; users re-login |
| `ENCRYPTION_KEY` | Breaks stored OAuth tokens / health PHI | Re-connect Google per household; health re-entry |
| S3 keys | Upload/download failure | Update env; rolling restart |
| Stripe webhooks (M5) | Billing desync | Rotate in Stripe dashboard + env |

## Capacity — when to shard Starter vs Family

| Signal | Action |
|--------|--------|
| Postgres CPU > 70% sustained | Scale instance; evaluate read replica for reports |
| Connection pool exhaustion | Add PgBouncer; reduce pool size per API replica |
| Household count > ~500 on shared RLS | Plan Family tier (Neon per household) per ADR 003 |
| Storage per household | Enforce `DRIVE_QUOTA_ENFORCE` (on by default hosted) |

## Related docs

- [HOSTED_RLS.md](../docs/HOSTED_RLS.md) — tenant context helpers
- [HOSTED_TENANT_TESTS.md](../docs/HOSTED_TENANT_TESTS.md) — leak matrix
- [ADR 003](../docs/adr/003-hosted-db-architecture.md) — architecture decisions
