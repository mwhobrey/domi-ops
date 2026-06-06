# Current state

*Updated after design system overhaul (tokens, overlays, dashboard stat tiles, list primitives). Dogfood/cutover still pending.*

## What is working (implemented paths)

### Platform

- Monorepo builds via Turbo (`npm run build`).
- Drizzle schema + SQL migrations (`packages/db/drizzle/`), including `school_submission_artifacts` (`0002`); `0017` drops `household_members.nickname` / `public_label`.
- `npm run db:migrate` and API Docker entrypoint apply migrations. New SQL must be registered in `packages/db/drizzle/meta/_journal.json` (see `03_RULES_AND_STANDARDS.md` → Database migrations).
- Zod env validation with production guards (`@whome/config`).
- Docker Compose dev stack: postgres, redis, minio, api, worker, web.
- Native `npm run dev` (default): `.env.example` / `WHOME_DEV_PROFILE=native` / `PORT=3000` / `PUBLIC_APP_URL=http://localhost:3000`; dev boot warns on OAuth port mismatch; `.env.docker.example` for compose web on :3001.
- Dashboard: glance (chores + school `/api/school/glance`) beside compact month calendar; weather via `/api/core/weather` (server → Open-Meteo).
- Notice board: `NoticeBoardActions` in page header on all `AppShell` pages; multi-notice feed + per-user read state (`notice_reads`); badge for unread from others.
- **Web Push (optional):** VAPID env (`VAPID_*`); migration `0010_push_notifications`; `push_subscriptions` + `users.push_notices_enabled`; notify household on `POST /notices` (excludes poster); profile opt-out + device subscribe; `sw.js` push/click → `/dashboard?notices=1`.
- Linear: WHO team; projects/milestones/issues in `docs/LINEAR.md` (module backlog WHO-14–WHO-75 in `docs/MODULE_AUDIT.md`); agent workflow `.cursor/rules/linear-workflow.mdc`.
- **CI:** `.github/workflows/ci.yml` — typecheck, build, test on push/PR.
- **Tests:** Vitest — config, crypto, import dry-run mappers (`npm run test`).
- **Import validate:** `npm run import:validate` — fixture dry-run; no `DATABASE_URL` or Postgres required.

### Auth

- **Better Auth** (`packages/auth/src/better-auth.ts`): email/password + **username plugin** + optional Google OAuth; Drizzle `ba_*` tables (`0015`); `users.username` / nullable `users.email` (`0016`). Drizzle adapter `schema` keys must match `modelName` (`users`, `ba_sessions`, …); `user.fields` maps BA `name`/`image` → Drizzle props `displayName`/`imageUrl` (not SQL column names).
- Login UI: `/login` — email or username sign-in; owner email sign-up; optional Google; logout via `authClient.signOut()` (Better Auth requires JSON — HTML form POST 415).
- **Household provisioning:** `POST /api/core/household/members/provision` (owner/admin) creates username-only members (`provision-member.ts`, no synthetic email).
- **Email verification:** Better Auth `emailVerification` + optional SMTP (`SMTP_*`, `EMAIL_VERIFICATION_REQUIRED`); dev logs link when SMTP unset (`packages/auth/src/mail.ts`).
- **Post-import join:** session hook auto-joins imported household; stub members claimed via `HOUSEHOLD_MEMBER_EMAIL_MAP` / display name. **Single-tenant (`DEPLOYMENT_MODE=single`):** only one household per DB — first login bootstraps owner; later email/Google logins join as `member` (repair merges orphan shadow households on session create).
- Whome session DTO: `GET /auth/session` (household member context for API/UI).
- Calendar OAuth remains separate (`/auth/google/calendar/*`); state in Redis.

### Web UI (`apps/web`)

- **Design system:** Expanded tokens in `globals.css`; `components/ui/*` including Modal/Sheet/Drawer (native `<dialog>`), StatTile, Avatar, Breadcrumb, ListItem, Checkbox, RadioGroup, LinkButton; Inter via `next/font`; lucide-react nav icons.
- **Shell:** Icon nav with accent active bar, user menu (ARIA), mobile Drawer with account footer; header gradient; breadcrumbs on school detail routes.
- **Calendar:** `/calendar` — Month, Week, Day, Agenda; shared scrollable 0–24h time grid (`CalendarTimeGrid`, `fillViewport` + `--calendar-chrome-height` for week/day); multi-day all-day span (`calendar-event-span.ts`, continued chip styling); desktop week/day — click slot to create, drag + resize editable timed events, **all-day drag** across columns; GET/PATCH/POST events — full DTO (`description`, `endDate`, `categoryKey`, `timeZone`, `reminderOffsets`, `repeatRule` daily/weekly/monthly); `POST .../duplicate`; GET span overlap query; **event sheet** — description, dates/times, calendar, **per-calendar category** (color from category when set), TZ, repeat builder, reminders, series delete scope; **event categories** scoped by `calendar_id` (migration `0014`) + `GET/POST/PATCH/DELETE /api/calendar/event-categories` (GET backfills default **General** per calendar); manager in Calendar settings; **category filter pills** (`whome:calendar-hidden-categories`); category color fallback on grid/agenda; **compact filter chrome** — single sticky toolbar row (`CalendarFilterBar`: inline write-to + Filters sheet for calendars/categories with search; `sessionStorage` hidden calendars, `localStorage` default write calendar); search + new event + view nav in same sticky region (`CalendarPageClient`); **calendar manager** in Google sheet; **recurring** — HomeHub `recurring_reminder` import, extended RRULE materialize (timed + MONTHLY subset), drag/delete `recurringScope`; **calendar reminder push** — `calendar_event_reminders`, worker `calendar.reminder.scan` (5m), profile `pushCalendarRemindersEnabled`; parity matrix `docs/CALENDAR_EVENT_PARITY.md`; Google sheet sync mode + bidirectional push; mobile Month + Agenda; **import wizard** (`CalendarImportWizard`, auto-open `?connected` / `?import`); **setup banner** (`CalendarSetupBanner`, dismiss `whome:calendar-setup-dismissed`); **Connect Google** uses `AnchorButton` / full-page nav to `/auth/google/calendar/start` (not Next `Link` — OAuth redirects require document navigation); login OAuth preserves `?next=` for calendar connect; sync progress polls `GET /api/calendar/sync/status`.
- **Dashboard:** **Today at a glance** (`GlanceTile`) — chore/school preview lines + counts via `/api/core/chores/glance` and `/api/school/glance`; weather widget (`useWeatherForecast`, Redis stale cache, structured errors); month calendar day sheet shows hourly weather per timed event when location saved; household presence + message; notice board auto-save.
- **Profile:** `/profile` — display name, presence + message, temperature unit, notice push opt-out + per-browser enable, **calendar reminder push** toggle (`pushCalendarRemindersEnabled`), avatar upload (JPEG/PNG/WebP → 256² WebP on S3, `GET /api/core/avatars/:memberId`).
- **Core lists:** Shopping/chores/notes/expenses use ListItem, Checkbox, SectionHeader, EmptyState icons; expenses month StatTile.
- **Tests:** `apps/web/src/lib/color-contrast.test.ts` in Vitest.
- **Docs:** `docs/UI.md`

### Core module

- API: `/api/core/weather` — `date`, `dayHourly`, `cached`, `source`, errors (`forecast_unavailable`, `location_outside_us_fallback`, `needsLocation`); `/api/core/chores/glance`; extended `/api/school/glance`; dashboard notice + home status PATCH; profile `temperatureUnit`, `pushNoticesEnabled`, `pushCalendarRemindersEnabled`; `/api/core/push/*` subscribe + VAPID public key; Web Push on new notice; shopping/chores/notes/expenses CRUD (`apps/api/src/routes/core.ts`).
- DB: migrations `0007`–`0014` (presence, temperature unit, avatar, push notifications, event categories + calendar reminders, per-calendar category scope). Journal includes `0013_event_categories_reminders` before `0014` (was missing — fresh DBs failed on `0014` ALTER).
- UI: interactive `/dashboard`, `/shopping`, `/chores`, `/notes`, `/expenses`.

### School module

- API: classes CRUD (PATCH term/teacher/schedule/archived), enrollments, assignments CRUD (incl. `categoryId`), **`GET /classes/:id/gradebook`**, categories CRUD, submit, grade, artifacts (`school.ts`); **`GET /api/school/context`** + role-scoped **`GET /classes`** / **`GET /glance`** (archived excluded by default); per-route **`access`** object from `apps/api/src/lib/school-access.ts` (household role + enrollment role).
- UI: **role-aware** (WHO-47) — view banner on `/school`; admin/staff see create class + full roster/gradebook; **student** sees enrolled classes only, own progress, submit workflow, no teacher actions; **observer** read-only. Assignment sheet includes category picker when categories exist.
- Routes: `/school`, `/school/reports`, `/school/class/[id]`, `/school/class/[id]/gradebook`, `/school/assignment/[id]` — conditional sections per `SchoolClassAccess`; assignment detail uses kid-friendly student turn-in flow (unified work card, plain-language status, upload-first with artifact preservation on save); teachers get **Student work** card with file list, image previews, and `GET /api/school/artifacts/:id/file` for authenticated download/view.
- **Gradebook matrix:** assignments down the left (sticky), students across the top — suited to homeschool (few students, many assignments). **`GET /api/school/reports`** + `/school/reports` — by class, by student, **category-weighted** grades, **open work digest**, **progress over time**, **transcript CSV export**; optional `?term=` filter.
- Parity matrix: `docs/SCHOOL_PARITY.md` (WHO-41).
- Manual QA runbook: `.cursor/runbook/05_SCHOOL_QA.md` (smoke routes, WHO-41–48 matrix, import SQL checks).
- Import: `school_submission_artifact` → `school_submission_artifacts` + S3 keys from file mapper; re-import hydrates `idMap` from `import_records` (school + files mappers).

### Calendar sync module

- Google OAuth connect discovers linked sources (`sync_enabled` false until import wizard commit).
- Google sync upserts by `google_event_id` **per household** (cross-lane match for HomeHub-imported events); fuzzy match when import row lacks `google_event_id`; post-sync dedupe + partial unique index `0012`.
- `POST /api/calendar/dedupe` and Google sheet **Remove duplicates** for one-off cleanup.
- **Calendar hierarchy:** `calendars` → **`event_categories`** (scoped by `calendar_id`, unique `(calendar_id, key)`) → `calendar_events.category_key`. Default category **`general`** per calendar (`is_default`); `GET /event-categories` backfills missing defaults. Import/sync assign new Google events there until recategorized. Event **color from category** (`event.color` null when categorized). Manage categories in Calendar settings (per calendar). Import wizard: calendar name + color only (no Google category mapping). **`@whome/calendar-sync` must be built** (`npm run build -w @whome/calendar-sync`); worker loads `dist/`.
- **Local event CRUD:** `POST/PATCH/DELETE /api/calendar/events`; GET date-range overlap + enriched DTO; `POST .../duplicate`; event-categories CRUD; PATCH enforces `calendar-event-policy`, optional `recurringScope`, enqueues Google push when `pushable`.
- **Lanes API:** `GET/POST/PATCH /api/calendar/calendars`, `GET /api/calendar/members`, `PATCH .../shares`, `POST /api/calendar/recurring/materialize`.
- **Recurring:** `materializeRecurringForHousehold` (DAILY/WEEKLY RRULE v1); job `recurring.materialize`.
- **Google push (bidirectional):** `packages/calendar-sync/src/push.ts` — outbox drain on `google.calendar.push` and after full sync.
- UI: `/calendar` + import wizard + toolbar **Calendar settings** sheet (accordion: Google / **Calendars** public·private·shared / categories); event sheet **rich HTML description** (TipTap + DOMPurify); `GET /calendars` includes `shareCount`.

### Import tooling

- CLI `npm run import:homehub` with `--dry-run`, `--strict`.
- Mappers: **notices**, **todo_item** (+ chore), **personal_calendar**, **`home_status` stub members** (single-pass school resolution), school artifacts, files→S3, full school LMS rows.
- `docs/IMPORT_REPORT.example.json` regression baseline (fixture dry-run).
- Real droplet `app.db` gate: operator copies DB per `docs/HOMEHUB_IMPORT.md` (not automated in CI).

### Ops

- Prod compose + **`import` service** (`Dockerfile.import`, profile `tools`).
- **Staging compose override** (`docker-compose.staging.yml`) — separate Postgres volume, port 5433 / web 3002.
- **`scripts/smoke-cutover.sh`** — health, optional import dry-run, OAuth reachability.
- Expanded **`deploy/CUTOVER.md`** — staging rehearsal, prod import, claim smoke, Caddy swap.
- **Dev MinIO:** `scripts/ensure-minio.mjs` creates S3 bucket after `dev:reset`; API boot calls `ensureS3Bucket` (`apps/api/src/lib/s3.ts`).
- **Single-tenant auth:** `packages/auth/src/single-tenant.ts` — second login joins canonical household; repairs orphan shadow households.

## Broken, stubbed, or incomplete

| Area | Evidence | Impact |
|------|----------|--------|
| Calendar **event** UX vs HomeHub | sheet: title/date/time/all-day only; no description, category, color, end date, multi-day | Event parity pass (see `docs/UI.md` calendar section) |
| Recurring (advanced) | weekly all-day v1 only; import skips `recurring_reminder` | Full RRULE + timed recurring + import mapper |
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
