# Current state

*Updated after four-lane web UI/UX pass + second polish pass. Dogfood/cutover still pending.*

## What is working (implemented paths)

### Platform

- Monorepo builds via Turbo (`npm run build`).
- Drizzle schema + SQL migrations (`packages/db/drizzle/`), including `school_submission_artifacts` (`0002`).
- `npm run db:migrate` and API Docker entrypoint apply migrations.
- Zod env validation with production guards (`@whome/config`).
- Docker Compose dev stack: postgres, redis, minio, api, worker, web.
- **CI:** `.github/workflows/ci.yml` — typecheck, build, test on push/PR.
- **Tests:** Vitest — config, crypto, import dry-run mappers (`npm run test`).
- **Import validate:** `npm run import:validate` — fixture dry-run with `--strict`.

### Auth

- Google OAuth login, session cookie, logout.
- **Post-import join:** Google login auto-joins imported household (`@whome/auth/join-imported.ts`); profile name/nickname + public label; no `HOUSEHOLD_MEMBER_EMAIL_MAP` required.
- OAuth state in Redis (login + calendar flows).

### Web UI (`apps/web`)

- **Design system:** `components/ui/*` (Button, Card, Alert, EmptyState, PageHeader, ConfirmDialog, etc.), `lib/cn.ts`, `lib/client-api.ts`.
- **Shell:** Top nav with active route, user menu, mobile drawer (`AppChrome`); `ProfileOnboardingBanner` when name unset.
- **Calendar:** Week/agenda views, week navigation, search (`q` API), event sheet, connect card (`CalendarPageClient`).
- **Dashboard:** Notice + who's home toggles, today-at-a-glance widgets (`DashboardBoard`).
- **Core lists:** `ListPage` wrapper for shopping/chores/notes/expenses; DELETE shopping/chores; `loading.tsx` on all main modules.
- **Second pass:** `Button` respects `type="submit"`; server `ApiError`; SSR load errors on profile/school detail/calendar status; TodayGlance chores due/overdue; calendar search clears to week view.
- **School:** Card-based class list and assignment flow styling.
- **Docs:** `docs/UI.md`

### Core module

- API: dashboard notice + home status PATCH, shopping/chores/notes/expenses CRUD (`apps/api/src/routes/core.ts`).
- UI: interactive `/dashboard`, `/shopping`, `/chores`, `/notes`, `/expenses`.

### School module

- API: classes CRUD, enrollments, assignments CRUD, submit, grade, submission artifacts (`school.ts`).
- UI: `/school`, `/school/class/[id]`, `/school/assignment/[id]` with presign upload client.
- Import: `school_submission_artifact` → `school_submission_artifacts` + S3 keys from file mapper.

### Calendar sync module

- Google connect + pull/full import jobs (unchanged).
- **Local event CRUD:** `POST/PATCH/DELETE /api/calendar/events`.
- UI: `/calendar` with event form + week view.

### Import tooling

- CLI `npm run import:homehub` with `--dry-run`, `--strict`.
- Mappers: **notices**, **todo_item** (+ chore), **personal_calendar**, school artifacts, files→S3, full school LMS rows.
- `docs/IMPORT_REPORT.example.json` regression baseline (fixture dry-run).
- Real droplet `app.db` gate: operator copies DB per `docs/HOMEHUB_IMPORT.md` (not automated in CI).

### Ops

- Prod compose + **`import` service** (`Dockerfile.import`, profile `tools`).
- **Staging compose override** (`docker-compose.staging.yml`) — separate Postgres volume, port 5433 / web 3002.
- **`scripts/smoke-cutover.sh`** — health, optional import dry-run, OAuth reachability.
- Expanded **`deploy/CUTOVER.md`** — staging rehearsal, prod import, claim smoke, Caddy swap.

## Broken, stubbed, or incomplete

| Area | Evidence | Impact |
|------|----------|--------|
| Calendar bidirectional push | `sync.ts` — `google.calendar.push` warns only | No push to Google |
| Recurring events | `recurring.materialize` stub | RRULE expansion not automated |
| Hosted multi-tenant | docs only | RLS not in code |
| `/api/core/files` product routes | not implemented | Import blobs under `imports/` only |
| **Production cutover on droplet** | operator checklist | Staging/prod import + Caddy flip not run in this repo session |
| Real `app.db` import counts | validated on **extended fixture** only | Droplet gate requires manual `scp` + live import |

## Immediate next steps (operator)

1. `scp` droplet `app.db` + `uploads/` → run live import + two-Google claim test locally or on staging volume.
2. `docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up` → `./scripts/smoke-cutover.sh` → browser module smoke.
3. Prod import + Caddy swap per `deploy/CUTOVER.md`; 48h soak before stopping HomeHub.

## Module enablement (default)

```
MODULES_ENABLED=core,school,calendar_sync
```
