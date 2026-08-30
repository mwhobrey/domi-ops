# Rollback plan (self-host)

This covers `docker-compose.prod.yml` self-host installs. For Domi Ops hosted (`app.domi-ops.com`),
see [deploy/HOSTED_OPS.md](../deploy/HOSTED_OPS.md) instead — same shape, DO-managed specifics.

Migrations are **forward-only** — Drizzle applies `packages/db/drizzle/*.sql` in order with no
generated "down" script (`packages/db/src/migrate.ts`). That makes backups, not migration
rollback, the actual safety net here. Take one before every update that includes a migration.

## Before you update: back up

```bash
# Postgres — from the host, against the running container
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-domi_ops}" "${POSTGRES_DB:-domi_ops}" | gzip > "backup-$(date +%Y%m%d-%H%M%S).sql.gz"

# MinIO / S3 — Drive files and health attachments live here, not in Postgres.
# Point `mc mirror` (MinIO client) or your S3-compatible backup tool at the bucket on a schedule;
# there's no in-repo tooling for this since it depends on your storage backend.
```

Automate the `pg_dump` on a cron job and keep at least a few days of rotation. Redis holds only
OAuth state and the job queue — nothing that needs backing up; workers reschedule on restart.

## Rolling back a bad app update (no migration involved)

Every image is tagged with its commit sha in addition to `latest` (`.github/workflows/publish-images.yml`).
Find the last-known-good sha from `git log` or the GHCR package page, then:

```bash
DOMI_OPS_IMAGE_TAG=<last-good-sha> docker compose -f docker-compose.prod.yml pull api worker web
DOMI_OPS_IMAGE_TAG=<last-good-sha> docker compose -f docker-compose.prod.yml up -d --no-build api worker web
```

If the bad update also changed `docker-compose.prod.yml` or another tracked file you rely on,
check that file out at the last-good commit too before restarting:

```bash
git checkout <last-good-sha> -- docker-compose.prod.yml
```

## Rolling back a bad migration

There's no automated "down" — pick one of these:

1. **Restore the pre-update `pg_dump`** (simplest, loses any writes made after the backup):
   ```bash
   docker compose -f docker-compose.prod.yml stop api worker
   gunzip -c backup-YYYYMMDD-HHMMSS.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U "${POSTGRES_USER:-domi_ops}" "${POSTGRES_DB:-domi_ops}"
   # then roll the app image back too, per the section above — the restored DB predates the migration
   docker compose -f docker-compose.prod.yml up -d --no-build api worker web
   ```
2. **Fix forward** — write a new migration that corrects the problem instead of reverting. Usually
   faster than a restore once real user data has landed on top of the bad schema, and it's the
   only option if you don't have a backup from before the migration ran.

Either way: stop `api` and `worker` first — both apply migrations / touch the schema on boot, and
you don't want a half-migrated write racing your restore.

## Verifying you're back to good

- `curl -sf https://your.domain/api/healthz`
- Log in, hit one page per enabled module (calendar, chores, whatever you use).
- `docker compose -f docker-compose.prod.yml logs --tail=100 api worker` — no repeating errors.

See also: [docs/RELEASE_PROCESS.md](RELEASE_PROCESS.md) (how images get tagged),
[docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md), [docs/SECURITY_REVIEW.md](SECURITY_REVIEW.md#sign-off-checklist-operator).
