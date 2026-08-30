# Components and files

## Top-level layout

```
domi-ops/
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
├── mise.toml         # Pins Node 22 (matches CI/Docker)
└── .env.example
```

## Apps

### `apps/web` — UI + edge auth gate

| Path | Responsibility |
|------|----------------|
| `src/app/page.tsx` | Landing; server fetches `/health` |
| `src/app/login/page.tsx` | Google sign-in entry |
| `src/app/dashboard/page.tsx` | Core dashboard via `apiFetch` |
| `src/components/DashboardBoard.tsx` | Home layout: glance → agenda+weather → household → month |
| `src/components/TodayGlance.tsx` | Chores/shopping/school/health glance tiles |
| `src/components/TodayAgenda.tsx` | Today’s calendar events + overlays |
| `src/app/calendar/page.tsx` | Calendar UI |
| `src/app/health/page.tsx` | Health tracker UI (`/health` — module-gated; API liveness is separate rewrite) |
| `src/app/health/sharing/page.tsx` | Health sharing management (`/health/sharing`) |
| `src/app/school/assignments/page.tsx` | School-wide due/overdue assignment list (`?filter=due\|overdue`) |
| `src/app/school/assignment/[id]/page.tsx` | Assignment detail |
| `src/app/school/assignment/[id]/materials/[materialId]/edit/page.tsx` | Full-page native test teacher editor (WHO-218) |
| `src/components/SchoolTestEditorClient.tsx` | Test editor chrome + Google Doc export (WHO-217) |
| `src/components/SchoolTestTakerClient.tsx` | Student take flow (WHO-215) |
| `src/components/SchoolNativeTestReview.tsx` | Teacher per-question review (WHO-216) |
| `src/components/SchoolTestQuestionEditor.tsx` | Question CRUD / preview |
| `src/app/shopping/page.tsx` | Shopping list |
| `src/app/chores/page.tsx`, `notes/page.tsx`, `expenses/page.tsx` | Core list modules |
| `src/app/profile/page.tsx` | Profile editor (identity, presence, prefs, integrations, notifications) |
| `src/components/ProfileCalendarConnect.tsx` | Slim Google Calendar connect status for profile |
| `src/components/ProfileGoogleDocsConnect.tsx` | Google Docs/Drive export OAuth connect on profile |
| `src/app/reports/page.tsx` | Central reports hub (`ReportsHubClient`) |
| `src/app/*/reports/page.tsx` | Per-module report pages (contextual entry; same section components as hub) |
| `src/components/ExpensesList.tsx` | Expenses list + Household|Personal budgets + shares (WHO-237) |
| `src/components/ExpenseEditSheet.tsx` | Expense edit + member attribution |
| `src/components/reports/ExpenseMonthlyReportSection.tsx` | Spending reports Household|Me scope |
| `src/components/reports/ReportExportSheet.tsx` | Shared export sheet (Drive, Google Docs/Drive, download CSV/JSON/YAML, print) |
| `src/components/reports/ReportsHubClient.tsx` | Module/kind picker + inline report runners |
| `src/lib/reports.ts` | Report module/kind types + hub URL helpers |
| `src/app/settings/page.tsx` | Household settings (owner/admin): name, timezone, slug, module toggles, members, integrations |
| `src/components/HouseholdSettingsEditor.tsx` | Household name/slug/timezone + module toggle checkboxes |
| `src/components/HouseholdMembersPanel.tsx` | Member list, role dropdown, username provisioning |
| `src/components/HouseholdIntegrationsPanel.tsx` | Read-only integrations health (Google, VAPID, S3) |
| `src/components/ScrollToTopFab.tsx` | Scroll-to-top FAB for long profile/settings pages |
| `src/app/*/loading.tsx` | Route-level skeletons (dashboard, calendar, lists, school, profile) |
| `src/app/auth/[[...path]]/route.ts` | Proxies `/auth/*` to API (cookies) |
| `src/middleware.ts` | Session check for protected routes |
| `src/lib/api.ts` | Server `apiFetch`, `apiBase`, `ApiError` |
| `src/lib/auth-links.ts` | OAuth URL helpers (client-safe import) |
| `src/lib/load-error.ts` | SSR `loadErrorMessage()` helper |
| `src/components/HealthPageClient.tsx` | Health events + medications UI |
| `src/components/HealthSharingClient.tsx` | `/health/sharing` — People ACL, shared-with-me, I've shared (WHO-230) |
| `src/components/HealthPeopleAccessPanel.tsx` | Segment ACL matrix with presets |
| `src/lib/calendar-filters.ts` | Calendar lane/category + overlay filter pills (`domi-ops:calendar-hidden-overlays`) |
| `src/lib/calendar-utils.ts` | Calendar DTO helpers; `isOverlayEvent`, overlay `source`/`deepLink` |
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

**Report kinds (WHO-155 / WHO-244):** `GET /api/core/reports/catalog` lists enabled modules. Kinds: `weekly`, `overview`, `medications`, `medications-today`, `medication-list`, `school-grades`, `school-open-work`, `school-transcript`. Health hub kinds: **Events**, **Today's doses**, **Dose history**, **Medication list**. Export: `POST /api/core/reports/export` with `destination`: `preview` | `domi-ops-drive` | `google-docs` | `google-drive`; preview includes `downloads` (`csv`, `json`, `yaml`). Print uses canonical HTML (`@media print`) plus on-screen `.report-print` CSS. Legacy `/api/core/weekly-reports/*` unchanged.


**State:** No Redux/Zustand. Server Components fetch via `apiFetch`; client components minimal. Session lives in HTTP-only cookie on API side.

### `apps/api` — REST + OAuth

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | App bootstrap, route mounting, CORS, DB |
| `src/middleware/auth.ts` | `createAuthMiddleware`, `requireAuth` |
| `src/routes/auth.ts` | Session, Google login/callback, logout |
| `src/routes/google-calendar-auth.ts` | Calendar OAuth + enqueue import |
| `src/routes/google-docs-auth.ts` | Google Docs/Drive export OAuth (`/auth/google/docs/*`) |
| `src/routes/weekly-reports.ts` | Weekly schedule reports + export (`/api/core/weekly-reports`; legacy alias) |
| `src/routes/reports.ts` | Unified reports catalog + export (`/api/core/reports`) |
| `src/lib/weekly-reports/` | Per-module Mon–Fri report builders (school, chores, shopping, expenses) |
| `src/lib/reports/` | Canonical report types, module overview adapters, shared export dispatch |
| `src/lib/report-render.ts` | Plain/styled HTML + CSV render for weekly + canonical reports |
| `src/lib/google-docs-export.ts` | Google Docs/Drive API + token refresh |
| `src/lib/school-test-google-export.ts` | Native test → Docs plain/html formatting (WHO-217) |
| `src/lib/school-test-google-import.ts` | Soft-parse Doc text → draft questions (WHO-219) |
| `src/routes/calendar.ts` | Connections, events, sync trigger; `GET /events` merges overlays |
| `src/lib/calendar-overlays.ts` | School due-date + health virtual events for calendar |
| `src/routes/household-health.ts` | `/api/health` — events, medications, dose log, glance, **`POST /medications/push-action`** (token, no session) |
| `src/lib/health-access.ts` | Health visibility + shares + segment ACL (WHO-229) |
| `src/lib/health-crypto.ts` | Field encryption for PHI-like health columns |
| `src/lib/health-serialize.ts` | Health DTO encrypt/decrypt + schedule JSON |
| `src/lib/expense-budget-access.ts` | Personal budget view/write + shares (WHO-237) |
| `src/lib/expenses.ts` | Expense serialize, category spend, budget summaries, reports |
| `src/routes/dashboard.ts` | `/dashboard`, home-status PATCH |
| `src/routes/weather.ts` | `/weather`, `/weather/geocode` |
| `src/routes/notices.ts` | Household notice board + in-app `/notifications` |
| `src/routes/push.ts` | VAPID public key, push subscribe/unsubscribe |
| `src/routes/shopping.ts` | Shopping list (+ `/shopping/glance`), recurring, receipts, reports |
| `src/routes/chores.ts` | Chores (+ `/chores/glance`), recurring, karma, reports |
| `src/routes/notes.ts` | Notes CRUD, sharing, tag suggestions |
| `src/routes/expenses.ts` | Expenses CRUD, budgets + shares, reports |
| `src/routes/profile.ts` | `/profile` + overlay prefs, avatars |
| `src/routes/household.ts` | `/household/settings`, `/household/integrations`, member roster/provisioning |
| `src/routes/school.ts` | Classes, assignments (`GET /assignments?filter=`), submissions |
| `src/routes/school-upload.ts` | Presign stub |
| `src/routes/health.ts` | API DB ping (`GET /health` on API host) |
| `Dockerfile` + `scripts/docker-entrypoint-api.sh` | Migrate on start |

The 10 files above (`dashboard.ts` through `household.ts`) replaced a single `core.ts` monolith
(2026-08-30 cleanup) — one resource per file, matching the `school.ts`/`drive.ts` convention.
Shared helpers (`posterLabel`, `loadEntityDriveAttachments`) moved to `src/lib/`.

### `apps/worker` — Queue consumer

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | BullMQ `Worker` on queue `domi-ops-calendar-sync`, delegates to `runCalendarSyncJob` |

## Packages

### `@domi-ops/config` (`packages/config`)

- `src/index.ts`: `envSchema`, `loadEnv()` (cached singleton), `isModuleEnabled()`.
- **Single source of truth** for env — API and worker call `loadEnv()` at startup.

### `@domi-ops/db` (`packages/db`)

| Path | Responsibility |
|------|----------------|
| `src/schema/household.ts` | `households`, `users`, `household_members` |
| `src/schema/auth.ts` | legacy `oauth_accounts` |
| `src/schema/better-auth.ts` | `ba_sessions`, `ba_accounts`, `ba_verifications` |
| `src/schema/calendar.ts` | Calendars, events, Google link tables, outbox |
| `src/schema/school.ts` | LMS tables |
| `src/schema/health.ts` | Health events, medications, dose logs, reminder sent, member ACL |
| `src/schema/core.ts` | Shopping, chores, notes, expenses (+ personal budgets/shares), notices, home_status |
| `src/schema/import.ts` | `import_records` |
| `src/client.ts` | `createDb(url)` |
| `src/migrate.ts` | Migration runner |
| `drizzle/*.sql` | Applied migrations (must be listed in `drizzle/meta/_journal.json`) |
| `drizzle/meta/_journal.json` | Migration order registry for `migrate:run` |
| `src/schema/push.ts` | `push_subscriptions` for Web Push (`timezone` = device IANA on subscribe) |
| `src/schema/google-docs.ts` | `google_docs_connections` (encrypted OAuth tokens for report export) |
| `drizzle.config.ts` | Drizzle Kit config |

Exports: `@domi-ops/db`, `@domi-ops/db/schema` (package.json `exports`).

### `@domi-ops/auth` (`packages/auth`)

- `session.ts` — cookie name, create/destroy session, `getSessionUserId`, `resolveAuthContext`.
- `google.ts` — OAuth URLs, token exchange.
- `bootstrap.ts` — first-login household creation.
- `join-imported.ts` — Google login auto-joins imported household (no email map).
- `member-label.ts` — `memberShownLabel()` from name/nickname/publicLabel.
- `claim.ts` — legacy claim path; prefer join-imported for post-import users.

### `@domi-ops/crypto` (`packages/crypto`)

- `encryptSensitive` / `decryptSensitive` for stored Google refresh tokens.
- `mintHealthMedPushActionToken` / `verifyHealthMedPushActionToken` — HMAC dose-action tokens for med push (WHO-235).

### `@domi-ops/calendar-sync` (`packages/calendar-sync`)

- `queue.ts` — `SYNC_QUEUE`, `enqueueSyncJob`.
- `sync.ts` — pull logic, `runCalendarSyncJob` switch (includes v1 stubs).
- `health-med-reminder-scan.ts` / `health-med-reminder-recipients.ts` — med push to subject + ACL `doses: write` (WHO-238).
- `budget-alert-scan.ts` — expense budget 80%/100% push; household vs personal recipients (WHO-237).
- `index.ts` — public exports; `registerSyncHandler` Map exists but **worker does not use it**.

### `@domi-ops/import-homehub` (`packages/import-homehub`)

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
- **health:** `health_*` tables (events, medications, logs, reminder sent)
- **calendar_sync:** `calendar_*`, `linked_google_calendars`, `calendar_sync_outbox`; overlay merge in `calendar-overlays.ts`
- **import:** `import_records`

All household-scoped rows tie to `auth.householdId` from session context.
