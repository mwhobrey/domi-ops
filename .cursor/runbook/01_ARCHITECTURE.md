# Architecture

## Tech stack

| Layer | Technology | Location |
|-------|------------|----------|
| Monorepo | npm workspaces + Turborepo 2.x | Root `package.json`, `turbo.json` |
| UI | Next.js 15, React 19, Tailwind 4 | `apps/web` |
| API | Hono 4 + `@hono/node-server` | `apps/api` |
| Jobs | BullMQ 5 + Redis 7 | `apps/worker`, `packages/calendar-sync` |
| ORM / DB | Drizzle ORM + PostgreSQL 16 | `packages/db` |
| Auth | Cookie sessions + Google OAuth | `packages/auth`, `packages/crypto` |
| Config | Zod env validation | `packages/config` |
| Object storage | S3-compatible (MinIO dev) | Env `S3_*`; presign stub in API |
| Import | better-sqlite3 → Postgres | `packages/import-homehub` |
| Runtime | Node ESM (`"type": "module"` in API) | `apps/api`, built `dist/` packages |
| Deploy | Docker Compose + Caddy (prod example) | `docker-compose.yml`, `docker-compose.prod.yml`, `deploy/` |

## System design patterns

- **Modular monolith (logical modules, physical monorepo):** Feature flags via `MODULES_ENABLED` (`core`, `school`, `calendar_sync`). Routes call `isModuleEnabled()` from `@whome/config` — not separate deployables.
- **BFF-style web layer:** Next.js rewrites `/api/*` to Hono; `/auth/*` uses a dedicated Route Handler so `Set-Cookie` lands on the browser origin (critical for Docker port 3001).
- **Single-tenant self-host (v1 default):** `DEPLOYMENT_MODE=single` — one household per Postgres instance. `households` table is the tenant root (`packages/db/src/schema/household.ts`). Hosted `shared` (RLS) / `dedicated` are documented in `docs/ARCHITECTURE.md` but **RLS is not implemented in migrations**.
- **Async calendar work:** API enqueues BullMQ jobs; worker calls `runCalendarSyncJob()` — no in-process long sync on request thread.
- **Idempotent migration:** HomeHub import writes `import_records` for re-runs (`packages/db/src/schema/import.ts`).

## Service topology

```
Browser
  → web (Next.js :3000 / Docker host :3001)
       ├─ middleware → GET api/auth/session (cookie forward)
       ├─ /auth/* → auth Route Handler → api /auth/*
       └─ /api/* rewrite → api /api/*
  → api (Hono :4000)
       ├─ Drizzle → postgres
       └─ enqueue → redis (BullMQ)
  → worker
       └─ calendar-sync jobs → postgres + Google APIs
  → minio (S3 API, dev only exposed)
```

Prod adds external `proxy` network for Caddy (`docker-compose.prod.yml`).

## Data flow

### 1. Authentication

1. User hits `/auth/google/login` (proxied to API).
2. API (`apps/api/src/routes/auth.ts`): in-memory OAuth state → Google token exchange → `findOrCreateUser` → `bootstrapHouseholdOnLogin` → `createSession` → cookie `whome_session` (`@whome/auth`).
3. Callback redirects to `PUBLIC_APP_URL/dashboard`.
4. Every API request: `createAuthMiddleware` reads cookie, `getSessionUserId`, `resolveAuthContext` → `auth` + `userId` on Hono context (`apps/api/src/middleware/auth.ts`).
5. Protected pages: Next middleware fetches `/auth/session` with forwarded cookies (`apps/web/src/middleware.ts`).

### 2. Core household data (CRUD)

- Browser/server: `apiFetch("/api/core/...")` with `credentials: "include"` (`apps/web/src/lib/api.ts`).
- API: `requireAuth` → scope queries by `auth.householdId` (e.g. `shoppingItems`, `chores` in `apps/api/src/routes/core.ts`).
- Mutations: JSON body → Drizzle insert/update → JSON response.

### 3. Google Calendar

1. Separate OAuth flow: `/auth/google/calendar/start` → callback encrypts tokens (`@whome/crypto`, HomeHub-compatible Fernet-style).
2. Links calendars in `calendar_connections`, `linked_google_calendars`.
3. `POST /api/calendar/sync` or post-connect callback enqueues `google.calendar.full_import` or `google.calendar.pull`.
4. Worker runs `pullLinkedCalendar` / `syncConnection` (`packages/calendar-sync/src/sync.ts`).
5. Default mode `import_only` from `GOOGLE_CALENDAR_DEFAULT_SYNC_MODE` (env + Zod in `@whome/config`).

**Not implemented in v1:** `google.calendar.push` (outbox), `recurring.materialize` (stubs log warnings only).

### 4. School LMS

- API routes under `/api/school` (`apps/api/src/routes/school.ts`): classes, assignments, submissions.
- Upload path `/api/school/upload/presign` returns a constructed URL — **not real S3 presign yet** (`school-upload.ts`).

### 5. HomeHub import (offline CLI)

- `npm run import:homehub` → `packages/import-homehub/dist/cli.js`.
- Reads HomeHub SQLite readonly → sequential mappers (household → calendar → tasks → …) → Postgres via `DATABASE_URL`.
- `--dry-run` counts/warns without writes.

### 6. Files (planned)

- Schema has no dedicated `files` API module in v1; `import-homehub` `files` mapper warns: S3 upload not implemented.
- MinIO provisioned in Compose for future school/shared uploads.

## External dependencies

| Service | Purpose | Config |
|---------|---------|--------|
| PostgreSQL | Primary datastore | `DATABASE_URL` |
| Redis | BullMQ | `REDIS_URL` |
| MinIO / S3 | Object storage | `S3_*` |
| Google OAuth | Login + Calendar API | `GOOGLE_OAUTH_*`, two redirect URIs on `PUBLIC_APP_URL` |
| Caddy (prod) | TLS + reverse proxy | `deploy/Caddyfile.example` → `web:3000` |

## API surface (Hono mounts)

From `apps/api/src/index.ts`:

| Mount | Module |
|-------|--------|
| `/health` | `health.ts` — `select 1` |
| `/auth` | `auth.ts` — session, Google login, logout |
| `/auth/google/calendar` | `google-calendar-auth.ts` |
| `/api/calendar` | `calendar.ts` |
| `/api/core` | `core.ts` |
| `/api/school` | `school.ts` |
| `/api/school/upload` | `school-upload.ts` |
| `GET /api/modules` | inline — enabled module flags |

Global: CORS to `PUBLIC_APP_URL` with credentials; auth middleware on all routes.

## Product tiers (design vs code)

`docs/ARCHITECTURE.md` describes OSS self-host, Hosted Starter (shared Postgres + RLS), Hosted Family (Neon per household). **v1 code path is OSS `DEPLOYMENT_MODE=single` only** — no RLS policies, no `HOSTED_TIER` in Zod schema (commented in `.env.example` only).
