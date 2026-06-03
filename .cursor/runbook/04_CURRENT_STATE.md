# Current state

*Updated after Combined Track: Cutover + Migration + Baseline implementation.*

## What is working (implemented paths)

### Platform

- Monorepo builds via Turbo (`npm run build`).
- Drizzle schema + SQL migrations (`packages/db/drizzle/`).
- `npm run db:migrate` and API Docker entrypoint apply migrations.
- Zod env validation with production guards (`@whome/config`).
- Docker Compose dev stack: postgres, redis, minio, api, worker, web.
- **CI:** `.github/workflows/ci.yml` — typecheck, build, test on push/PR.
- **Tests:** Vitest — `@whome/config` loadEnv, `@whome/crypto` round-trip, import dry-run mappers (`npm run test`).

### Auth

- Google OAuth login, session cookie, logout.
- `GET /auth/session` for middleware and clients.
- First-login household bootstrap (`@whome/auth/bootstrap`).
- Web auth proxy for cookie correctness.
- **OAuth state in Redis** (`apps/api/src/lib/oauth-state.ts`) — login + calendar flows; TTL 10m.

### Core module (`MODULES_ENABLED` includes `core`)

- API: dashboard (notices, home status), shopping CRUD, chores, notes, expenses (`apps/api/src/routes/core.ts`).
- UI pages: dashboard, shopping (`apps/web/src/app/`).

### School module

- API: list/create classes, assignments, submissions (`school.ts`).
- UI: `/school` page.
- Schema: full LMS table set in `packages/db/src/schema/school.ts`.
- **S3 presign:** real `PutObject` presigned URLs (`school-upload.ts`).

### Calendar sync module

- Google Calendar OAuth connect flow (`google-calendar-auth.ts`).
- Pull / full import jobs via BullMQ (`google.calendar.pull`, `google.calendar.full_import`).
- API: connections, calendars, events, manual sync enqueue (`calendar.ts`).
- UI: `/calendar` with connect/sync components.
- Default `import_only` sync mode.

### Import tooling

- CLI `npm run import:homehub` with `--dry-run`.
- Mappers: household, calendar, tasks, shopping, notes, expenses, **school (full LMS rows)**, **files (S3 upload + import_records)**.
- `import_records` table for idempotency tracking.
- Docs: `docs/HOMEHUB_IMPORT.md`, `deploy/CUTOVER.md`.

### Ops

- Health check with DB ping.
- Prod compose + Caddy example for DigitalOcean-style deploy.
- HomeHub migration documented in README and `docs/ARCHITECTURE.md`.
- **MIT LICENSE** in repo root.

## Broken, stubbed, or incomplete

| Area | Evidence | Impact |
|------|----------|--------|
| Calendar bidirectional push | `sync.ts` — `google.calendar.push` warns only | Changes in whome do not sync to Google |
| Recurring events | `recurring.materialize` stub | RRULE expansion not automated |
| HomeHub school file artifacts | `school_submission_artifact` not migrated | Submission metadata only; linked files need manual re-upload if needed |
| Hosted multi-tenant | `docs/ARCHITECTURE.md` only | RLS / Neon per household not in code |
| Files module (product doc) | Listed in `docs/ARCHITECTURE.md` core | No `/api/core/files` routes; import stores blobs under `imports/{householdId}/files/` |
| Production cutover | Operator checklist in `deploy/CUTOVER.md` | Caddy swap + live import on droplet not automated |

## Immediate next steps (recommended priority)

1. **Production cutover** — Follow `deploy/CUTOVER.md`: copy `app.db` from droplet, prod compose, live import, OAuth smoke, Caddy swap.
2. **Google OAuth console** — Both redirect URIs on `PUBLIC_APP_URL` per `docs/GOOGLE_OAUTH_SETUP.md`.
3. **Optional:** `google.calendar.push` + `recurring.materialize` if leaving `import_only`.
4. **Optional:** Migrate `school_submission_artifact` rows to presigned keys.

## Git / release state

- Combined track implementation on `master` (local) — CI, tests, import mappers, OAuth Redis, presign, docs.
- Treat production cutover as **operator step** on existing HomeHub droplet.

## Module enablement (default)

From `.env.example`:

```
MODULES_ENABLED=core,school,calendar_sync
```

Disable modules by removing from comma list and restarting API/worker/web.
