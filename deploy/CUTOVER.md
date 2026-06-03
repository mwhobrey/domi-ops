# Production cutover (same droplet as HomeHub)

## Pre-flight

- [ ] `.env` on droplet: `POSTGRES_PASSWORD`, `SESSION_SECRET` (32+), `ENCRYPTION_KEY`, Google OAuth, `PUBLIC_APP_URL=https://your.domain`
- [ ] Each family member signs in with Google once (auto-joins imported household); set nicknames on Profile
- [ ] Google Cloud: both redirect URIs on `PUBLIC_APP_URL` ([docs/GOOGLE_OAUTH_SETUP.md](../docs/GOOGLE_OAUTH_SETUP.md))
- [ ] HomeHub `app.db` + `uploads/` paths known on server
- [ ] Worker env includes `GOOGLE_*`, `ENCRYPTION_KEY`, `REDIS_URL` (see `docker-compose.prod.yml`)

## Staging pass (required)

Use a **separate Postgres volume** so prod data stays untouched:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up -d --build
# Migrations run via API container entrypoint
export DATABASE_URL=postgresql://whome:$POSTGRES_PASSWORD@localhost:5433/whome
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads --dry-run --strict
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads
```

Staging smoke (browser, not curl-only):

- [ ] Two Google accounts each claim a distinct imported member on **one** household
- [ ] Dashboard notice + home status edit
- [ ] Shopping, chores, notes, expenses interactive
- [ ] Calendar local event create/edit/delete
- [ ] School class → assignment → submit → presign upload → grade

```bash
./scripts/smoke-cutover.sh
# SMOKE_BASE_URL=https://staging.your.domain SMOKE_API_URL=... ./scripts/smoke-cutover.sh
```

## Production import

One-shot import container (or host `npm run import:homehub` with prod `DATABASE_URL`):

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL=postgresql://whome:$POSTGRES_PASSWORD@postgres:5432/whome \
  -v /path/to/homehub/data:/import:ro \
  import --sqlite /import/app.db --uploads /import/uploads
```

Re-import is idempotent (`import_records` dedupe). Run dry-run first.

## Prod smoke tests

- [ ] `GET https://your.domain/api/health`
- [ ] Google login → dashboard (claim flow)
- [ ] `/school`, `/calendar`, core modules
- [ ] Calendar connect → worker processes `google.calendar.full_import`
- [ ] School presign upload lands in MinIO

## Caddy swap

1. Update Caddyfile: `reverse_proxy web:3000` (see [Caddyfile.example](./Caddyfile.example))
2. `caddy reload` or restart Caddy container
3. Verify HTTPS site loads whome

## Soak & rollback

- Run 24–48h before stopping HomeHub
- **Rollback:** revert Caddy upstream to HomeHub only; Postgres volume backup if needed

## After cutover

- Stop HomeHub compose stack when satisfied
- `GOOGLE_CALENDAR_DEFAULT_SYNC_MODE=import_only` unless bidirectional is implemented
- Update `.cursor/runbook/04_CURRENT_STATE.md` with verified droplet behavior
