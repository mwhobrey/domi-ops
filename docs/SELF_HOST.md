# Self-hosting whome

> **Household admins:** start with **[SETUP.md](./SETUP.md)** for step-by-step paths, configuration in plain language, optional Google setup, and best practices. This document is the technical reference.

whome is designed for a single household per PostgreSQL instance (`DEPLOYMENT_MODE=single`). This guide consolidates local dev, production Docker, migrations, optional modules, and common troubleshooting.

## Prerequisites

- **Node.js 20+** (for local dev and import CLI)
- **Docker + Docker Compose** (recommended for production)
- **Domain + TLS** (Caddy or similar reverse proxy)
- **Secrets:** `SESSION_SECRET` (32+ chars), `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`
- **Optional:** Google Cloud OAuth client for sign-in and Calendar sync

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

**Docker-only dev** (web on host :3001): copy `.env.docker.example` → `.env`, then `docker compose up --build`. Do not mix native and Docker profiles without updating OAuth redirect URIs.

## Environment variables

Copy `.env.example` and set at minimum:

| Variable | Notes |
|----------|-------|
| `PUBLIC_APP_URL` | Browser origin — OAuth redirects derive from this |
| `API_URL` | Internal API base (web → api) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | BullMQ worker queue |
| `SESSION_SECRET` | Better Auth signing (min 32 chars) |
| `ENCRYPTION_KEY` | OAuth token encryption |
| `AUTH_REQUIRED` | Must be `true` in production |
| `S3_*` | MinIO locally; S3-compatible in prod |
| `MODULES_ENABLED` | Comma list: `core,school,calendar_sync,drive` |

Production boot **fails** if `SESSION_SECRET` is too short, `ENCRYPTION_KEY` is missing, `AUTH_REQUIRED` is off, or `calendar_sync` is enabled without Google OAuth credentials.

See `.env.example` for Drive quotas, VAPID Web Push, SMTP email verification, and weather defaults.

## Production (Docker Compose)

One compose file brings up the **full stack** — Postgres, Redis, MinIO, API, worker, and web. No external database or object store required.

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY, PUBLIC_APP_URL=https://your.domain
# Set S3_ACCESS_KEY / S3_SECRET_KEY (MinIO credentials — compose runs MinIO for you)
# Set GOOGLE_OAUTH_* if using Google sign-in or Calendar

docker compose -f docker-compose.prod.yml up -d --build
```

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

Caddy must be on the same network to `reverse_proxy web:3000` — see [deploy/Caddyfile.example](../deploy/Caddyfile.example).

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
  -e DATABASE_URL=postgresql://whome:$POSTGRES_PASSWORD@postgres:5432/whome \
  -v /path/to/homehub/data:/import:ro \
  import --sqlite /import/app.db --uploads /import/uploads
```

## Optional modules

Controlled by `MODULES_ENABLED` at deploy time and per-household toggles in **Settings** (owner/admin).

| Module | Key | Requires |
|--------|-----|----------|
| Core lists, dashboard, notices | `core` | Always on |
| Homeschool LMS | `school` | — |
| Google Calendar sync | `calendar_sync` | `GOOGLE_OAUTH_*`, worker |
| Household Drive | `drive` | `S3_*` configured |

`core` cannot be disabled. Other modules can be turned off per household without redeploying.

## Google OAuth

Required for Google sign-in and Calendar sync. Configure **both** redirect URIs in Google Cloud Console:

- `{PUBLIC_APP_URL}/auth/callback/google` — Better Auth sign-in
- `{PUBLIC_APP_URL}/auth/google/calendar/callback` — Calendar connect

Step-by-step: [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md).

In development, `GET /health` returns `dev.oauthRedirects` when `NODE_ENV=development`.

## Privacy policy

A minimal privacy page ships at `/privacy` for OAuth consent screens. Link it from your login footer or Google Cloud consent configuration.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| OAuth `invalid_request` | Redirect URIs / JavaScript origins must exactly match `PUBLIC_APP_URL` |
| Login works on :3001 but not :3000 | Profile mismatch — use one dev path; see `.env.example` vs `.env.docker.example` |
| `relation does not exist` | Run `npm run db:migrate` or restart API container |
| Migration silently skipped | New `.sql` file missing from `packages/db/drizzle/meta/_journal.json` |
| Calendar sync idle | Check worker logs, `REDIS_URL`, `GOOGLE_OAUTH_*`, worker `ENCRYPTION_KEY` |
| Avatar/upload fails | Verify `S3_*` and MinIO bucket (`scripts/ensure-minio.mjs` on dev reset) |
| Web Push not delivered | Set `VAPID_*` env vars; user must enable in Profile |
| `EADDRINUSE :3000` | Stop stale `next dev` or run infra-only: `docker compose up -d postgres redis minio` |

## Further reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design
- [CONTRIBUTING.md](../CONTRIBUTING.md) — dev workflow
- [README.md](../README.md) — project overview
