# Self-hosting Domi Ops

> **Household admins:** start with **[SETUP.md](./SETUP.md)** for step-by-step paths, configuration in plain language, optional Google setup, and best practices. This document is the technical reference.

Domi Ops is designed for a single household per PostgreSQL instance (`DEPLOYMENT_MODE=single`). This guide covers local dev, production Docker, migrations, optional modules, and common troubleshooting.

## Prerequisites

- **Node.js 20+** (for local dev and the import CLI)
- **Docker + Docker Compose** (recommended for production)
- **Domain + TLS** (Caddy or a similar reverse proxy)
- **Secrets:** `SESSION_SECRET` (32+ chars), `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`
- **Optional:** a Google Cloud OAuth client for sign-in and Calendar sync

## Quick local dev

```bash
cp .env.example .env
# Edit SESSION_SECRET and ENCRYPTION_KEY if testing production guards

docker compose up -d postgres redis minio
npm install
npm run build
npm run db:migrate
npm run dev
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:4000/health |

**Reset:** `npm run dev:reset` wipes Docker volumes, re-runs migrations, flushes Redis.

**Docker-only dev** (web on host :3001): copy `.env.docker.example` to `.env`, then `docker compose up --build`. Do not mix native and Docker profiles without updating OAuth redirect URIs.

## Environment variables

Copy `.env.example` and set at minimum:

| Variable | Notes |
|----------|-------|
| `PUBLIC_APP_URL` | Browser origin. OAuth redirects derive from this |
| `API_URL` | Internal API base (web to api) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | BullMQ worker queue |
| `SESSION_SECRET` | Better Auth signing (min 32 chars) |
| `ENCRYPTION_KEY` | OAuth token + health field encryption |
| `AUTH_REQUIRED` | Must be `true` in production |
| `SETUP_TOKEN` | Greenfield only: min 16 chars; `/setup` or `bootstrap:owner` (see [SETUP.md](./SETUP.md)) |
| `POSTGRES_PASSWORD` | Required for `docker-compose.prod.yml` (compose builds `DATABASE_URL`) |
| `S3_*` | MinIO locally; S3-compatible in prod |
| `MODULES_ENABLED` | Comma list: `core,school,calendar_sync,drive,health` |

Production boot **fails** if `SESSION_SECRET` is too short, `ENCRYPTION_KEY` is missing, `AUTH_REQUIRED` is off, or `calendar_sync` is enabled without Google OAuth credentials. With `health` in `MODULES_ENABLED`, `ENCRYPTION_KEY` is also required in production (field encryption for health records).

See `.env.example` for Drive quotas, VAPID Web Push, SMTP email verification, and weather defaults.

## Production (Docker Compose)

One compose file brings up the **full stack**: Postgres, Redis, MinIO, API, worker, and web. No external database or object store required.

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY, PUBLIC_APP_URL=https://your.domain
# Set S3_ACCESS_KEY / S3_SECRET_KEY (MinIO credentials; compose runs MinIO for you)
# Set GOOGLE_OAUTH_* if using Google sign-in or Calendar

docker compose -f docker-compose.prod.yml up -d --build
```

**First owner (greenfield):** set `SETUP_TOKEN` in `.env`, restart API, then open `/setup` or run `npm run bootstrap:owner`. See [SETUP.md § First login](./SETUP.md#first-login-and-household-setup).

- **Migrations** run automatically when the API container starts (`packages/db/dist/migrate.js` in the API entrypoint).
- **S3 bucket** is created on first API boot (`ensureS3Bucket` in `apps/api/src/lib/s3.ts`).
- **Services:** `postgres`, `redis`, `minio`, `api`, `worker`, `web` (plus `import` under profile `tools`).
- Postgres/Redis/MinIO are not exposed on host ports by default.
- **Caddy / existing reverse proxy:** join a shared Docker network:

```bash
# Confirm network name: docker network ls
PROXY_NETWORK=headscale_default docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.proxy-external.yml up -d --build
```

Caddy must be on the same network to `reverse_proxy web:3000`. See [deploy/Caddyfile.example](../deploy/Caddyfile.example).

### Staging rehearsal

Use a separate Postgres volume before touching production data:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up -d --build
./scripts/smoke-cutover.sh
```

Full cutover checklist: [deploy/CUTOVER.md](../deploy/CUTOVER.md).

### HomeHub import

```bash
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads --dry-run --strict
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads
```

Requires `config.yml` beside the SQLite DB for member roster and claim emails. See [HOMEHUB_IMPORT.md](./HOMEHUB_IMPORT.md).

Production one-shot import container:

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL=postgresql://domi_ops:$POSTGRES_PASSWORD@postgres:5432/domi_ops \
  -v /path/to/homehub/data:/import:ro \
  import --sqlite /import/app.db --uploads /import/uploads
```

## Optional modules

Controlled by `MODULES_ENABLED` at deploy time and per-household toggles in **Settings** (owner/admin).

| Module | Key | Requires |
|--------|-----|----------|
| Core lists, dashboard, notices | `core` | Always on |
| Homeschool LMS | `school` | Nothing extra |
| Google Calendar sync | `calendar_sync` | `GOOGLE_OAUTH_*`, worker |
| Household Drive | `drive` | `S3_*` configured |
| Health tracker | `health` | `ENCRYPTION_KEY` in production |

`core` cannot be disabled. Other modules can be turned off per household without redeploying.

### Sensitive modules (health)

Domi Ops is **not** a HIPAA-covered entity and does not claim HIPAA compliance. When the `health` module is enabled:

- **In transit:** use HTTPS in production (Caddy or your reverse proxy). Plain HTTP dev is not suitable for real health data.
- **At rest (application):** titles, notes, medication names/dosage/instructions, and dose log notes are encrypted in PostgreSQL via `@domi-ops/crypto`, keyed by `ENCRYPTION_KEY` (the same key as Google OAuth tokens).
- **At rest (operator):** encrypt your Postgres volume or enable full-disk encryption on the host. Domi Ops does not manage disk-level encryption.
- **Key rotation:** rotating `ENCRYPTION_KEY` requires re-encrypting stored health fields (same limitation as OAuth tokens today; no migration tooling in v1).

## Google OAuth

Required for Google sign-in and Calendar sync. Configure **both** redirect URIs in Google Cloud Console:

- `{PUBLIC_APP_URL}/auth/callback/google` for Better Auth sign-in
- `{PUBLIC_APP_URL}/auth/google/calendar/callback` for Calendar connect

Step-by-step: [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md).

In development, `GET /health` returns `dev.oauthRedirects` when `NODE_ENV=development`.

## Privacy policy

A minimal privacy page ships at `/privacy` for OAuth consent screens. Link it from your login footer or Google Cloud consent configuration.

## Troubleshooting

See **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** for a full index. Quick hits:

| Symptom | Fix |
|---------|-----|
| OAuth `invalid_request` | Redirect URIs / JavaScript origins must exactly match `PUBLIC_APP_URL` |
| Login works on :3001 but not :3000 | Profile mismatch; use one dev path (see `.env.example` vs `.env.docker.example`) |
| `relation does not exist` | Run `npm run db:migrate` or restart the API container |
| Migration silently skipped | New `.sql` file missing from `packages/db/drizzle/meta/_journal.json` |
| Calendar sync idle | Check worker logs, `REDIS_URL`, `GOOGLE_OAUTH_*`, worker `ENCRYPTION_KEY` |
| Avatar/upload fails | Verify `S3_*` and the MinIO bucket (`scripts/ensure-minio.mjs` on dev reset) |
| Web Push not delivered | Set `VAPID_*` env vars; user must enable in Profile |
| `EADDRINUSE :3000` | Stop stale `next dev` or run infra-only: `docker compose up -d postgres redis minio` |
| GHCR pull denied | `docker login ghcr.io` with PAT `read:packages` (see [SETUP.md Path C](./SETUP.md#path-c-production-with-pre-built-images)) |
| Cannot create first owner | `SETUP_TOKEN` + `/setup` (see [SETUP.md](./SETUP.md#first-login-and-household-setup)) |

## Further reading

- [SETUP.md](./SETUP.md): step-by-step paths for household admins
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md): common failures index
- [ROLLBACK.md](./ROLLBACK.md): backups and rolling back a bad update or migration
- [SECURITY_REVIEW.md](./SECURITY_REVIEW.md): pre-launch security checklist
- [ARCHITECTURE.md](./ARCHITECTURE.md): system design
- [CONTRIBUTING.md](../CONTRIBUTING.md): dev workflow
- [README.md](../README.md): project overview
