# Troubleshooting

Quick index for self-host operators. Start with [SETUP.md](./SETUP.md) for the happy path; use this when something breaks.

## First-time install

| Symptom | Cause | Fix |
|---------|-------|-----|
| Cannot create owner account | `ALLOW_PUBLIC_SIGNUP=false` and no setup path | Set `SETUP_TOKEN` (min 16 chars), open `/setup`, or run `npm run bootstrap:owner` — see [SETUP.md § First login](./SETUP.md#first-login-and-household-setup) |
| `/setup` says token not configured | `SETUP_TOKEN` missing from `.env` | Add to `.env`, restart API: `docker compose -f docker-compose.prod.yml up -d api` |
| `/setup` closed but no users | Household already exists | Sign in at `/login`; or reset DB if this was a mistake (staging only) |
| `relation does not exist` / 500 on login | Migrations not applied | `npm run db:migrate` locally, or restart API container (migrations run on start) |
| API container exits on boot | Invalid `.env` | Check logs: `docker compose -f docker-compose.prod.yml logs api` — Zod lists missing/short secrets |

## Authentication & sessions

| Symptom | Cause | Fix |
|---------|-------|-----|
| Google `redirect_uri_mismatch` | GCP redirect URIs ≠ `PUBLIC_APP_URL` | Add **exact** URIs: `{PUBLIC_APP_URL}/auth/callback/google` and `…/auth/google/calendar/callback` — [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) |
| Login works on :3000 but not :3001 | Mixed dev profiles | Pick one: native `.env.example` (:3000) **or** `.env.docker.example` (:3001) |
| "Unauthorized" on every page | Cookie / URL mismatch | `PUBLIC_APP_URL` must match browser origin (scheme + host + port); use HTTPS in production |
| Google sign-up blocked during setup | No setup grant | Complete `/setup` token unlock before Google OAuth |
| Session lost after deploy | `SESSION_SECRET` changed | Keep `SESSION_SECRET` stable across deploys or all users re-login |

## Docker & GHCR

| Symptom | Cause | Fix |
|---------|-------|-----|
| `pull access denied` for `ghcr.io/mwhobrey/domi-ops-*` | Not logged in to GHCR | `echo "$GHCR_PAT" \| docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin` (PAT needs `read:packages`) — [SETUP.md Path C](./SETUP.md#path-c-production-with-pre-built-images) |
| `set POSTGRES_PASSWORD` compose error | Env not loaded | `set -a && source .env && set +a` before `docker compose` |
| Old images after `git pull` | Forgot pull/up | `export DOMI_OPS_IMAGE_TAG=latest && docker compose -f docker-compose.prod.yml pull api worker web && docker compose -f docker-compose.prod.yml up -d --no-build` |
| Web can't reach API | Wrong `API_URL` in web container | Production compose sets internal URL; if custom, ensure web env points at `http://api:4000` |

## Calendar & worker

| Symptom | Cause | Fix |
|---------|-------|-----|
| Calendar sync never runs | Worker down or Redis missing | `docker compose … ps` — worker running? `REDIS_URL` set? |
| `google_oauth_not_configured` | Empty Google env vars | Set `GOOGLE_OAUTH_CLIENT_ID` / `SECRET`; enable `calendar_sync` module |
| `invalid_grant` on calendar | Revoked Google refresh token | Reconnect in Profile → Calendar |
| Recurring / reminders missing | Worker not processing jobs | Check worker logs; restart worker after env changes |

## Uploads & Drive

| Symptom | Cause | Fix |
|---------|-------|-----|
| Upload fails / 403 on PUT | Bad presign token or size | Check `DRIVE_UPLOAD_MAX_BYTES`; retry presign; API logs |
| MinIO connection refused | MinIO not up | `docker compose … ps minio`; internal `S3_ENDPOINT=http://minio:9000` in prod |
| Avatar broken | S3 keys / bucket | Dev: `npm run dev:reset`; prod: verify `S3_*` match MinIO root user |
| Public share 404 | Feature disabled | `DRIVE_PUBLIC_SHARES_ENABLED=true` or use authenticated Drive links |

## Push notifications

| Symptom | Cause | Fix |
|---------|-------|-----|
| No push on phone | VAPID not configured | Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| iOS never prompts | PWA not installed | Add to Home Screen first (iOS 16.4+) |
| Push works once then stops | Stale subscription | Re-enable in Profile → notifications; check worker logs for 410 prune |

## Database & migrations

| Symptom | Cause | Fix |
|---------|-------|-----|
| Migration skipped silently | SQL not in Drizzle journal | Register in `packages/db/drizzle/meta/_journal.json` — runbook `03` |
| Need clean slate (dev only) | Wipe volumes | `npm run dev:reset` |
| Prod data restore | Operator backup | `pg_dump` / `pg_restore` — [SETUP.md § Backups](./SETUP.md#backups) |

## Health module

| Symptom | Cause | Fix |
|---------|-------|-----|
| `encryption_key_required` | `ENCRYPTION_KEY` unset with `health` module | Set key in `.env` before enabling module |
| Garbled health text after key change | Key rotation without re-encrypt | Avoid rotating `ENCRYPTION_KEY` without migration tooling |

## Still stuck?

1. API health: `curl -s https://your.domain/health` (or `:4000/health` locally)
2. Logs: `docker compose -f docker-compose.prod.yml logs api worker web --tail 100`
3. Smoke script: `./scripts/smoke-cutover.sh` (staging)
4. [SELF_HOST.md](./SELF_HOST.md) for the technical reference
5. [GitHub Issues](https://github.com/mwhobrey/domi-ops/issues) (after repo is public)
