# Rules and standards

## Coding conventions

### Language & modules

- **TypeScript strict** — root `tsconfig.json`: `strict`, `ES2022`, `moduleResolution: bundler`.
- **ESM in API/worker/packages** — import paths use `.js` extensions in emitted/import specifiers (e.g. `./middleware/auth.js`).
- **Workspace package names:** `@whome/<name>`; apps `@whome/web`, `@whome/api`, `@whome/worker`.
- **Internal deps:** `"@whome/db": "*"` workspace protocol in package.json files.

### Naming

- DB tables: snake_case plural (`shopping_items`, `auth_sessions`).
- Drizzle schema files: domain nouns (`household.ts`, `calendar.ts`).
- API routes: Hono `app.get("/shopping")` under mount prefix (`/api/core` + `/shopping` → `/api/core/shopping`).
- Sync job names: dotted strings (`google.calendar.pull`, `google.calendar.full_import`).
- Session cookie: `whome_session` (`@whome/auth` — verify in `packages/auth/src/session.ts` if changing).

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
- Push/recurring stubs: `console.warn` only — **silent no-op** from operator perspective.

### Import CLI

- `ImportReport` collects `errors[]` and `warnings[]`; SQLite open failure returns early with error string.
- Mappers append warnings for dry-run / incomplete paths — read report after every import.

## State management rules

| State | Owner | Rule |
|-------|-------|------|
| Session | Postgres `auth_sessions` + cookie | API is source of truth; web never stores tokens in localStorage |
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

### Docker full stack

- `docker compose up` builds `api`, `worker`, `web`.
- API entrypoint runs `packages/db/dist/migrate.js` before `node dist/index.js`.
- Web host port **3001** → container 3000 (avoids local `:3000` conflict).

### Production

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

- Requires `POSTGRES_PASSWORD` in env.
- Services on `whome_internal` + external `proxy` network for Caddy.
- No host ports on postgres/redis/minio in prod file.
- Cutover: follow `deploy/CUTOVER.md` — staging volume (`docker-compose.staging.yml`), import service (`Dockerfile.import`), smoke script, then Caddy → `web:3000`.

**Migrate:** Automatic on API container start (not separate `docker compose exec ... db:migrate` unless running CLI manually — `docs/ARCHITECTURE.md` step 2 is outdated vs Dockerfile entrypoint).

## Gotchas & technical debt

1. **Auth proxy vs rewrite** — `/auth` must stay on Route Handler; rewrites break `Set-Cookie` domain for Docker `:3001`.
2. **Two Google OAuth flows** — login (`/auth/google/login`) and calendar (`/auth/google/calendar/*`); both redirect URIs must be in Google Cloud Console (`docs/GOOGLE_OAUTH_SETUP.md`).
3. **Middleware dev bypass** — Broken API in dev still shows protected pages; production does not bypass.
4. **`requireAuth` dev bypass** — API allows unauthenticated access to protected routes when `AUTH_REQUIRED=false` in development.
5. **Calendar push / recurring** — Jobs enqueue but worker only warns (`packages/calendar-sync/src/sync.ts`).
6. **School presign** — Real `@aws-sdk/s3-request-presigner`; requires S3 env in API.
7. **HomeHub import** — Real droplet `app.db` not in CI; use `npm run import:validate` on fixture + `--strict` on operator dry-run.
8. **Post-import auth** — Set `HOUSEHOLD_MEMBER_EMAIL_MAP` or match Google displayName to `legacyDisplayName`; no auto household bootstrap when `import_records` exist.
9. **`registerSyncHandler` in calendar-sync** — Dead code path; worker calls `runCalendarSyncJob` directly.
10. **OAuth state** — Redis-backed (`REDIS_URL` required for login/calendar CSRF).
11. **RLS / hosted tiers** — Documented only; schema has `deployment_tier` enum but no policies.
12. **LICENSE** — MIT in repo root.
13. **`packages/db/dist/`** — May be committed or built locally; migrations run from `dist/migrate.js` in Docker.
14. **better-sqlite3** — Rebuild after Node version change: `npm rebuild better-sqlite3 -w @whome/import-homehub`.

## Commit message convention (project lead preference)

When Mike requests commits:

`[JIRA-TICKET] :gitmoji: type(scope): summary`

Body bullets: `* :gitmoji: detail`. No trailers. See user rules / gitmoji.dev.
