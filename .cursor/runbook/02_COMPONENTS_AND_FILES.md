# Components and files

## Top-level layout

```
whome/
├── apps/
│   ├── web/          # Next.js UI
│   ├── api/          # Hono REST + OAuth callbacks
│   └── worker/       # BullMQ consumer
├── packages/
│   ├── config/       # Zod env, module flags
│   ├── crypto/       # OAuth token encryption
│   ├── db/           # Drizzle schema + migrations
│   ├── auth/         # Sessions, Google OAuth, household bootstrap
│   ├── calendar-sync/# Google pull + queue helpers
│   └── import-homehub/ # SQLite → Postgres CLI
├── deploy/           # Caddyfile.example
├── docs/             # ARCHITECTURE, GOOGLE_OAUTH_SETUP
├── scripts/          # docker-entrypoint-api.sh
├── docker-compose.yml
├── docker-compose.prod.yml
├── turbo.json
├── tsconfig.json     # Root strict, noEmit
└── .env.example
```

## Apps

### `apps/web` — UI + edge auth gate

| Path | Responsibility |
|------|----------------|
| `src/app/page.tsx` | Landing; server fetches `/health` |
| `src/app/login/page.tsx` | Google sign-in entry |
| `src/app/dashboard/page.tsx` | Core dashboard via `apiFetch` |
| `src/app/calendar/page.tsx` | Calendar UI |
| `src/app/school/page.tsx` | School LMS UI |
| `src/app/shopping/page.tsx` | Shopping list |
| `src/app/chores/page.tsx`, `notes/page.tsx`, `expenses/page.tsx` | Core list modules |
| `src/app/profile/page.tsx` | Profile editor (name, nickname, public label, home status) |
| `src/app/*/loading.tsx` | Route-level skeletons (dashboard, calendar, lists, school, profile) |
| `src/app/auth/[[...path]]/route.ts` | Proxies `/auth/*` to API (cookies) |
| `src/middleware.ts` | Session check for protected routes |
| `src/lib/api.ts` | Server `apiFetch`, `apiBase`, `ApiError` |
| `src/lib/auth-links.ts` | OAuth URL helpers (client-safe import) |
| `src/lib/load-error.ts` | SSR `loadErrorMessage()` helper |
| `src/lib/use-media-query.ts` | `useIsDesktop()` for calendar responsive |
| `src/lib/color-contrast.ts` | WCAG text color for event chips |
| `src/lib/member-color.ts` | Deterministic avatar hues |
| `src/components/lists/ListPage.tsx` | Shared list layout (add form card + errors) |
| `src/lib/auth-proxy.ts` | Forward auth requests to `API_URL` |
| `src/components/AppShell.tsx` | Server shell + session |
| `src/components/AppChrome.tsx` | Top nav, active route, user menu, mobile drawer |
| `src/components/ui/*` | Shared UI primitives (Modal, Sheet, Drawer, StatTile, Avatar, Breadcrumb, etc.) |
| `src/lib/client-api.ts` | Browser API client |
| `docs/UI.md` | UI conventions |
| `next.config.ts` | `standalone` output; rewrites `/api`, `/health` |
| `Dockerfile` | Build arg `API_URL` for server-side fetch |

**Routing:** App Router file-based routes only — no separate `routes.ts`.

**State:** No Redux/Zustand. Server Components fetch via `apiFetch`; client components minimal. Session lives in HTTP-only cookie on API side.

### `apps/api` — REST + OAuth

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | App bootstrap, route mounting, CORS, DB |
| `src/middleware/auth.ts` | `createAuthMiddleware`, `requireAuth` |
| `src/routes/auth.ts` | Session, Google login/callback, logout |
| `src/routes/google-calendar-auth.ts` | Calendar OAuth + enqueue import |
| `src/routes/calendar.ts` | Connections, events, sync trigger |
| `src/routes/core.ts` | Dashboard, shopping, chores, notes, expenses |
| `src/routes/school.ts` | Classes, assignments, submissions |
| `src/routes/school-upload.ts` | Presign stub |
| `src/routes/health.ts` | DB ping |
| `Dockerfile` + `scripts/docker-entrypoint-api.sh` | Migrate on start |

### `apps/worker` — Queue consumer

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | BullMQ `Worker` on queue `whome-calendar-sync`, delegates to `runCalendarSyncJob` |

## Packages

### `@whome/config` (`packages/config`)

- `src/index.ts`: `envSchema`, `loadEnv()` (cached singleton), `isModuleEnabled()`.
- **Single source of truth** for env — API and worker call `loadEnv()` at startup.

### `@whome/db` (`packages/db`)

| Path | Responsibility |
|------|----------------|
| `src/schema/household.ts` | `households`, `users`, `household_members` |
| `src/schema/auth.ts` | legacy `oauth_accounts` |
| `src/schema/better-auth.ts` | `ba_sessions`, `ba_accounts`, `ba_verifications` |
| `src/schema/calendar.ts` | Calendars, events, Google link tables, outbox |
| `src/schema/school.ts` | LMS tables |
| `src/schema/core.ts` | Shopping, chores, notes, expenses, notices, home_status |
| `src/schema/import.ts` | `import_records` |
| `src/client.ts` | `createDb(url)` |
| `src/migrate.ts` | Migration runner |
| `drizzle/*.sql` | Applied migrations (must be listed in `drizzle/meta/_journal.json`) |
| `drizzle/meta/_journal.json` | Migration order registry for `migrate:run` |
| `src/schema/push.ts` | `push_subscriptions` for Web Push |
| `drizzle.config.ts` | Drizzle Kit config |

Exports: `@whome/db`, `@whome/db/schema` (package.json `exports`).

### `@whome/auth` (`packages/auth`)

- `session.ts` — cookie name, create/destroy session, `getSessionUserId`, `resolveAuthContext`.
- `google.ts` — OAuth URLs, token exchange.
- `bootstrap.ts` — first-login household creation.
- `join-imported.ts` — Google login auto-joins imported household (no email map).
- `member-label.ts` — `memberShownLabel()` from name/nickname/publicLabel.
- `claim.ts` — legacy claim path; prefer join-imported for post-import users.

### `@whome/crypto` (`packages/crypto`)

- `encryptSensitive` / `decryptSensitive` for stored Google refresh tokens.

### `@whome/calendar-sync` (`packages/calendar-sync`)

- `queue.ts` — `SYNC_QUEUE`, `enqueueSyncJob`.
- `sync.ts` — pull logic, `runCalendarSyncJob` switch (includes v1 stubs).
- `index.ts` — public exports; `registerSyncHandler` Map exists but **worker does not use it**.

### `@whome/import-homehub` (`packages/import-homehub`)

- `src/importer.ts` — `runImport` orchestration.
- `src/mappers/*.ts` — per-domain SQLite → Postgres (varying completeness).
- `src/cli.ts` — CLI entry; root script `import:homehub`.

## Configuration map

| Concern | Where |
|---------|--------|
| Env vars + validation | `.env.example`, `packages/config/src/index.ts` |
| Module toggles | `MODULES_ENABLED` env |
| Next rewrites / standalone | `apps/web/next.config.ts` |
| Drizzle migrations | `packages/db/drizzle/`, `npm run db:migrate` |
| Turbo task graph | `turbo.json` |
| TypeScript base | `tsconfig.json` + per-package `tsconfig.json` |
| Docker dev | `docker-compose.yml` |
| Docker prod | `docker-compose.prod.yml` |
| Edge TLS / proxy | `deploy/Caddyfile.example` |

## Auth & API routing (critical)

| Path type | Mechanism |
|-----------|-----------|
| `/api/*` | Next **rewrite** → `API_URL` |
| `/health` | Next rewrite |
| `/auth/*` | Next **Route Handler** proxy (not rewrite) — preserves cookies on web origin |
| Protected UI | `middleware.ts` → `API_URL/auth/session` |

Browser calls use `apiBase() === ""` so fetches are same-origin; server components use `API_URL` (e.g. `http://api:4000` in Docker).

## Database entities by module

- **core:** `shopping_items`, `chores`, `notes`, `expenses`, `notices`, `notice_reads`, `home_status`
- **school:** `school_*` tables (classes through attendance)
- **calendar_sync:** `calendar_*`, `linked_google_calendars`, `calendar_sync_outbox`
- **import:** `import_records`

All household-scoped rows tie to `auth.householdId` from session context.
