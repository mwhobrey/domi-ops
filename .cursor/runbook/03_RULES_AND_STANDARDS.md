# Rules and standards

## Coding conventions

### Language & modules

- **TypeScript strict** — root `tsconfig.json`: `strict`, `ES2022`, `moduleResolution: bundler`.
- **ESM in API/worker/packages** — import paths use `.js` extensions in emitted/import specifiers (e.g. `./middleware/auth.js`).
- **Workspace package names:** `@whome/<name>`; apps `@whome/web`, `@whome/api`, `@whome/worker`.
- **Internal deps:** `"@whome/db": "*"` workspace protocol in package.json files.

### Naming

- DB tables: snake_case plural (`shopping_items`, `ba_sessions`).
- Drizzle schema files: domain nouns (`household.ts`, `calendar.ts`).
- API routes: Hono `app.get("/shopping")` under mount prefix (`/api/core` + `/shopping` → `/api/core/shopping`).
- Sync job names: dotted strings (`google.calendar.pull`, `google.calendar.full_import`).
- Session cookies: Better Auth (`ba_sessions` table; cookie names managed by BA — forward all cookies in server `apiFetch`).

### Formatting & linting

- **No Prettier config** at repo root.
- **ESLint:** only `apps/web` — `"lint": "next lint"` (Next defaults). API, worker, packages have **no lint script**; root `npm run lint` only hits workspaces that define it (effectively web).
- **Typecheck:** `npm run typecheck` via Turbo (`dependsOn: ["^build"]`).

### Env & secrets

- Copy `.env.example` → `.env`; never commit `.env`.
- Production boot **fails** `loadEnv()` if:
  - `SESSION_SECRET` < 32 chars
  - `ENCRYPTION_KEY` missing
  - `AUTH_REQUIRED` disabled
  - `calendar_sync` enabled without Google OAuth creds  
  (see `packages/config/src/index.ts` `superRefine`).
- `AUTH_REQUIRED=false` only meaningful in development — pairs with `requireAuth` bypass and middleware dev fallback.

## Error handling

### API (Hono)

- **Auth:** `requireAuth` → `401` JSON `{ error: "unauthorized" }` unless dev bypass (`!AUTH_REQUIRED && NODE_ENV === development`).
- **Module disabled:** `403` with `{ error: "<module>_disabled" }` (e.g. `core_disabled`).
- **Config:** Invalid env throws at startup with Zod issue list — process exits, no partial boot.
- **No global error handler** — unhandled exceptions become 500 from Hono default; add explicit `try/catch` when introducing risky IO.

### Web

- `apiFetch`: non-OK → `throw new Error(\`API ${status}: ${text}\`)` — Server Components will error boundary unless caught.
- **Middleware:** session fetch failure → redirect `/login?next=...`; in **development only**, network failure allows through (`apps/web/src/middleware.ts`) — do not rely on this for security testing.

### Worker

- Unknown job name → `throw new Error(\`Unknown sync job: ...\`)` — BullMQ will retry/fail per queue config (check worker defaults when changing).
- Unknown or disabled job handlers log warnings; calendar push/recurring materialize jobs are implemented in worker when `calendar_sync` is enabled.

### Import CLI

- `ImportReport` collects `errors[]` and `warnings[]`; SQLite open failure returns early with error string.
- Mappers append warnings for dry-run / incomplete paths — read report after every import.

## State management rules

| State | Owner | Rule |
|-------|-------|------|
| Session | Better Auth `ba_sessions` + HTTP-only cookie | API is source of truth; web never stores tokens in localStorage |
| OAuth CSRF state | Redis keys `oauth:login:*`, `oauth:calendar:*` (10m TTL) | Requires `REDIS_URL`; API uses `ioredis` |
| Google tokens | `oauth_accounts` encrypted | Use `@whome/crypto`; never log decrypted tokens |
| UI data | Server fetch per request | No shared client store; refetch on navigation |
| Calendar sync | Redis queue + DB rows | Trigger via API only; worker idempotent pull per linked calendar |
| Module flags | Env at boot | Changing `MODULES_ENABLED` requires restart |

## Testing

| Item | Status |
|------|--------|
| Unit tests | Vitest — `npm run test` (config, crypto, import dry-run) |
| E2E | **None** |
| CI | `.github/workflows/ci.yml` — typecheck, build, test |

**Manual verification checklist:**

1. `GET /health` → DB connected
2. Google login → `/dashboard` loads
3. `npm run typecheck` at root
4. `npm run lint` (web)
5. Calendar connect + `POST /api/calendar/sync` → worker logs pull
6. `npm run import:homehub -- --dry-run` against HomeHub SQLite

When adding tests, prefer: `@whome/config` parsing, `@whome/crypto` round-trip, mapper dry-runs with fixture SQLite, API auth middleware with test DB.

## Deployment pipelines

### Local dev

```bash
docker compose up -d postgres redis minio
npm install && npm run build && npm run db:migrate
npm run dev
```

- **Fresh dev DB:** `npm run dev:reset` — `docker compose down -v`, `up -d postgres redis minio --wait`, `redis-cli FLUSHALL`, `npm run db:migrate` (see `scripts/dev-reset.mjs`).

- **Default dev path:** native `npm run dev` → browser `http://localhost:3000`, `.env.example` (`WHOME_DEV_PROFILE=native`, `PORT=3000`, `PUBLIC_APP_URL=http://localhost:3000`).
- **Alternate:** full Docker stack → host `http://localhost:3001`, use `.env.docker.example` (`WHOME_DEV_PROFILE=docker`). Do not mix profiles without updating Google OAuth redirect URIs.
- Root `.env` is loaded by `@whome/config` `loadEnv()` (api/worker) and `apps/web/next.config.ts` (Next). Development boot warns on `PUBLIC_APP_URL` / profile mismatch; `GET /health` includes `dev.oauthRedirects`.
- If `EADDRINUSE :3000`, stop a stale `next dev` or run only infra: `docker compose up -d postgres redis minio` (omit `web`/`api` when using native dev).

### Docker full stack

- `docker compose up` builds `api`, `worker`, `web`.
- API entrypoint runs `packages/db/dist/migrate.js` before `node dist/index.js`.
- Web host port **3001** → container 3000 (avoids local `:3000` conflict).

### Production

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

- Requires `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` in env (MinIO runs in-stack).
- Full stack: `postgres`, `redis`, `minio`, `api`, `worker`, `web` — no external DB/S3 required.
- Caddy on an existing Docker network: add `-f docker-compose.proxy-external.yml` and set `PROXY_NETWORK`.
- No host ports on postgres/redis/minio in prod file (staging override exposes `:5433` / `:3002`).
- Cutover: follow `deploy/CUTOVER.md` — staging volume (`docker-compose.staging.yml`), import service (`Dockerfile.import`), smoke script, then Caddy → `web:3000`.

**Migrate:** Automatic on API container start (not separate `docker compose exec ... db:migrate` unless running CLI manually — `docs/ARCHITECTURE.md` step 2 is outdated vs Dockerfile entrypoint).

## Database migrations (Drizzle)

Migrations live in `packages/db/drizzle/*.sql`. The runner (`packages/db/src/migrate.ts` → `npm run db:migrate` at repo root) uses Drizzle’s migrator, which **only applies SQL files listed in** `packages/db/drizzle/meta/_journal.json`. A new `.sql` file without a journal entry is **silently skipped** — schema drift without an error.

### When to use `generate` vs hand-written SQL

| Path | Use when |
|------|----------|
| `npm run generate -w @whome/db` (`drizzle-kit generate`) | Schema changed in `packages/db/src/schema/*.ts`; Kit emits SQL + journal + snapshot under `drizzle/meta/`. Review diff, then commit all three. |
| Hand-written `NNNN_name.sql` | Small, explicit DDL (column add, index, data fix) when you already know the SQL and want full control. **You must register the file in `_journal.json` yourself.** |

This repo often uses hand-written numbered migrations (`0007_home_status_presence.sql`, etc.) after updating the TypeScript schema in the same change.

### Checklist — add a migration

1. **Edit schema** — `packages/db/src/schema/*.ts` (Drizzle column/table definitions used by the app).
2. **Add SQL** — `packages/db/drizzle/NNNN_short_snake_name.sql` (next index: one higher than the latest file and journal `idx`).
3. **Register journal** — append to `packages/db/drizzle/meta/_journal.json` → `entries[]`:
   - `idx`: same number as migration prefix (0-based sequence; must match order).
   - `tag`: **exact** SQL basename without `.sql` (e.g. `0009_member_avatar_key`).
   - `when`: unique increasing millisecond timestamp (e.g. `Date.now()` or +1000 ms per prior entry).
   - `version`: `"7"`, `breakpoints`: `true` (match existing entries).
4. **Optional snapshot** — `drizzle-kit generate` updates `drizzle/meta/*_snapshot.json`; not required for `migrate:run` but keeps Kit in sync if you use `generate` later.
5. **Apply** — from repo root with Postgres up and `DATABASE_URL` in `.env`:
   ```bash
   npm run db:migrate
   ```
   (builds `@whome/db` then runs `dist/migrate.js`.)
6. **Verify** — console prints `Running migrations from .../drizzle` and `Migrations complete`; no error. Re-run is idempotent. In DB, `drizzle.__drizzle_migrations` lists applied tags; spot-check new columns/tables.

### Commands reference

| Command | Purpose |
|---------|---------|
| `npm run db:migrate` (root) | Local / CI: build + apply pending journal migrations |
| `npm run migrate:run -w @whome/db` | Apply only (after `build -w @whome/db`) |
| `npm run migrate -w @whome/db` | `drizzle-kit migrate` (Kit CLI; prefer root `db:migrate` for this repo) |
| `npm run generate -w @whome/db` | Generate SQL + journal from schema diff |
| API Docker entrypoint | `packages/db/dist/migrate.js` before API start |

### Common failures

- **SQL exists, DB unchanged** — missing or wrong `tag` in `_journal.json`, or `idx` out of order.
- **`relation already exists`** — migration partially applied or duplicate tag; fix DB manually or adjust migration (never re-use a deployed tag).
- **`DATABASE_URL is required`** — no `.env` at repo root when running `migrate:run`.

## Gotchas & technical debt

1. **Auth proxy vs rewrite** — `/auth` must stay on Route Handler; rewrites break `Set-Cookie` domain for Docker `:3001`. Proxy must forward each `Set-Cookie` via `getSetCookie()` (comma-joined cookies break OAuth state).
2. **localhost vs 127.0.0.1** — `PUBLIC_APP_URL` / Google redirect URIs use one loopback host (usually `localhost`). Cookies set on `127.0.0.1` are not sent on `localhost` callbacks → Better Auth `state_security_mismatch`. Dev middleware + auth proxy redirect `127.0.0.1` → canonical host; browse `http://localhost:3000` (or `:3001` docker).
2b. **GHCR web image + OAuth** — CI builds the web image without your droplet `PUBLIC_APP_URL`. `auth-client` must use `window.location.origin` in the browser (same-origin `/auth/*` proxy). API/worker still read runtime `PUBLIC_APP_URL` from `.env` for Better Auth `baseURL` and Google redirect URIs.
3. **Two Google OAuth flows** — login via Better Auth (`/auth/callback/google`) and calendar (`/auth/google/calendar/*`); both redirect URIs must be in Google Cloud Console (`docs/GOOGLE_OAUTH_SETUP.md`).
4. **API auth middleware order** — `createAuthMiddleware` in `apps/api/src/index.ts` must run **before** `googleCalendarAuthRoutes`; `/start` reads `c.get("auth")`. If registered after, logged-in users get bounced to `/login?next=/auth/google/calendar/start` and can hit a redirect loop.
5. **Middleware dev bypass** — Broken API in dev still shows protected pages; production does not bypass.
4. **`requireAuth` dev bypass** — API allows unauthenticated access to protected routes when `AUTH_REQUIRED=false` in development.
5. **Calendar push / recurring** — Jobs enqueue but worker only warns (`packages/calendar-sync/src/sync.ts`).
6. **School presign** — Real `@aws-sdk/s3-request-presigner`; requires S3 env in API.
7. **HomeHub import** — Real droplet `app.db` not in CI; use `npm run import:validate` on fixture + `--strict` on operator dry-run.
8. **Post-import auth** — Google/email login joins imported household; claim emails from HomeHub `config.yml` import; profile display name + home/away.
9. **`registerSyncHandler` in calendar-sync** — Dead code path; worker calls `runCalendarSyncJob` directly.
10. **OAuth state** — Better Auth login uses `ba_verifications` + signed `better-auth.state` cookie; calendar connect uses Redis (`oauth:calendar:*`). Both require matching browser host with `PUBLIC_APP_URL`.
11. **RLS / hosted tiers** — Documented only; schema has `deployment_tier` enum but no policies.
12. **LICENSE** — MIT in repo root.
13. **`packages/db/dist/`** — May be committed or built locally; migrations run from `dist/migrate.js` in Docker.
14. **Drizzle journal** — Unlisted `.sql` files are not applied; see **Database migrations (Drizzle)** above.
15. **better-sqlite3** — Rebuild after Node version change: `npm rebuild better-sqlite3 -w @whome/import-homehub`.

## Commit message convention (project lead preference)

When Mike requests commits:

`[JIRA-TICKET] :gitmoji: type(scope): summary`

Body bullets: `* :gitmoji: detail`. No trailers. See user rules / gitmoji.dev.
