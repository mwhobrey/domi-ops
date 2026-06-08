# Current state

*Updated after local dogfood QA — phases 0–5 pass (`.cursor/runbook/06_DOGFOOD_TEST_PHASES.md`). Staging/prod cutover pending.*

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
- **Post-import join:** session hook moves users onto the **import marker** household; stubs claimed via **`users.import_claim_email`** + `import_records` (`homehub_claim_email`) from HomeHub **`config.yml`**, then Google display name / username fallback. Optional deprecated env: `HOUSEHOLD_MEMBER_EMAIL_MAP`. **Single-tenant:** live import targets the **oldest** household when one already exists.
- Whome session DTO: `GET /auth/session` (household member context for API/UI).
- Calendar OAuth remains separate (`/auth/google/calendar/*`); state in Redis. **`createAuthMiddleware` must run before calendar routes** so `/start` sees session (WHO-84).

### Web UI (`apps/web`)

- **Design system:** Expanded tokens in `globals.css`; `components/ui/*` including Modal/Sheet/Drawer (native `<dialog>`), StatTile, Avatar, Breadcrumb, ListItem, Checkbox, RadioGroup, LinkButton; Inter via `next/font`; lucide-react nav icons.
- **Shell:** Icon nav with accent active bar, user menu (ARIA), mobile Drawer with account footer; header gradient; breadcrumbs on school detail routes.
- **Calendar:** `/calendar` — Month, Week, Day, Agenda; shared scrollable 0–24h time grid (`CalendarTimeGrid`, `fillViewport` + `--calendar-chrome-height` for week/day); multi-day all-day span (`calendar-event-span.ts`, continued chip styling); desktop week/day — click slot to create, drag + resize editable timed events, **all-day drag** across columns; GET/PATCH/POST events — full DTO (`description`, `endDate`, `categoryKey`, `timeZone`, `reminderOffsets`, `repeatRule` daily/weekly/monthly); `POST .../duplicate`; GET span overlap query; **event sheet** — description, dates/times, calendar, **per-calendar category** (color from category when set), TZ, repeat builder, reminders, series delete scope; **event categories** scoped by `calendar_id` (migration `0014`) + `GET/POST/PATCH/DELETE /api/calendar/event-categories` (GET backfills default **General** per calendar); manager in Calendar settings; **category filter pills** (`whome:calendar-hidden-categories`); category color fallback on grid/agenda; **compact filter chrome** — single sticky toolbar row (`CalendarFilterBar`: inline write-to + Filters sheet for calendars/categories with search; `sessionStorage` hidden calendars, `localStorage` default write calendar); search + new event + view nav in same sticky region (`CalendarPageClient`); **calendar manager** in Google sheet; **recurring** — HomeHub `recurring_reminder` import, extended RRULE materialize (timed + MONTHLY subset), drag/delete `recurringScope`; **calendar reminder push** — `calendar_event_reminders`, worker `calendar.reminder.scan` (5m), profile `pushCalendarRemindersEnabled`; parity matrix `docs/CALENDAR_EVENT_PARITY.md`; Google sheet sync mode + bidirectional push; mobile Month + Agenda; **import wizard** (`CalendarImportWizard`, auto-open `?connected` / `?import`); **setup banner** (`CalendarSetupBanner`, dismiss `whome:calendar-setup-dismissed`); **Connect Google** uses `AnchorButton` / full-page nav to `/auth/google/calendar/start` (not Next `Link` — OAuth redirects require document navigation); login OAuth preserves `?next=` for calendar connect; sync progress polls `GET /api/calendar/sync/status`.
- **Dashboard:** **Today at a glance** (`GlanceTile`) — chore/school preview lines + counts via `/api/core/chores/glance` and `/api/school/glance`; weather widget (`useWeatherForecast`, Redis stale cache, structured errors); month calendar day sheet shows hourly weather per timed event when location saved; household presence + message; notice board auto-save.
- **Profile & household settings:** `/profile` — card-grid editor (identity, presence, preferences, integrations, notifications) with two-column layout on large screens and sticky save bar on mobile; **Google Calendar connect status** (`ProfileCalendarConnect`, `GET /api/calendar/status` + `/connections`); tab nav to `/settings` for owner/admin. `/settings` — role-guarded household name, slug, timezone (`GET/PATCH /api/core/household/settings`), member provisioning panel (`HouseholdMembersPanel`); user menu links **Your profile** + **Household settings**. Profile fields: display name, presence + message, temperature unit, notice push opt-out + per-browser enable, **calendar reminder push** toggle (`pushCalendarRemindersEnabled`), **chore reminder push** toggle (`pushChoresRemindersEnabled`), avatar upload (JPEG/PNG/WebP → 256² WebP on S3, `GET /api/core/avatars/:memberId`).
- **Core lists:** Shopping/chores/notes/expenses use ListItem, Checkbox, SectionHeader, EmptyState icons; **expenses** month StatTile, **edit sheet** (`ExpenseEditSheet`), delete confirm, **category Combobox** (`GET /expenses/category-suggestions`), **monthly budgets** with spend-vs-target progress (`expense_budgets`, `GET/POST/PATCH/DELETE /expenses/budgets`), budget threshold **Web Push** (80%/100%, worker `expense.budget.scan` 30m, profile `pushExpenseBudgetAlertsEnabled`), **spending reports** at `/expenses/reports` (`GET /expenses/reports?month=YYYY-MM` — month glance, by-category progress, 6-month trend, top categories, budget health labels, biggest purchases); balances spike doc `docs/EXPENSES_BALANCES_SPIKE.md` (defer build). **Shopping** (`ShoppingList`): item + aisle autocomplete (`GET /api/core/shopping/suggestions`, `aisle-suggestions`), optional aisle/qty/unit/notes/cost on add/edit, aisle badge + group-by-aisle toggle, recurring templates (`shopping_recurring`, check-on-load materialize on `GET /shopping`), clear purchased → trip history (`POST /shopping/clear`) with optional receipt presign (`POST /shopping/receipt/presign`), per-item/trip cost + optional Groceries expense; reports at `/shopping/reports` (`GET /shopping/reports`); `tags_json` aisle prefix `aisle:` via `apps/api/src/lib/shopping.ts`; migrations `0019_shopping_quantity`, `0020_shopping_expansion`. **Chores** (`ChoresList`): filter All/Open/Overdue, **list filter + group-by-list** (`list:` tag prefix in `tags_json`, mirrors shopping `aisle:`); inline due-date edit, **edit sheet** (`ChoreEditSheet`; title/list/due/tags/priority/assignee; **Make recurring** section promotes open one-off chores → template with interval picker), tag + **list** combobox suggestions (`GET /chores/list-suggestions`), priority + assignee on add, recurring templates (**daily**/weekly/biweekly/monthly, materialize on `GET /chores`); **Household Karma** points + streaks on completion, overdue chores framed as **Redemption quests**; karma leaderboard + completion banner; PATCH returns `completion` karma payload; worker `chore.reminder.scan` (5m) with redemption push copy + profile opt-out; reports at `/chores/reports` (`GET /chores/reports`, `GET /chores/karma`); HomeHub import maps `todo_list` → `list:` tag (not description prefix); parity matrix `docs/CHORES_PARITY.md`; migrations `0021_chores_expansion`, `0022_chores_karma`. **Notes** (`NotesList`): **required title** on create/edit (input above `MarkdownEditor`; card heading with content excerpt when collapsed), **pin to top** (`pinned` boolean; `aria-pressed` toggle on list card + edit sheet; sort `pinned DESC`, `created_at DESC`), **Markdown** compose (`MarkdownEditor` Write/Rich/Preview tabs — Rich = TipTap WYSIWYG via `@tiptap/markdown`; Preview = `react-markdown` + GFM), expand/collapse with plain-text excerpt, **edit sheet** (`NoteEditSheet`), **tags** on create/edit (comma input + datalist suggestions; chips on cards), **search + tag filter** on `/notes` (`GET /notes?q=&tag=` server-side over visible notes; `q` matches title **and** content; labeled search input; keyboard-friendly tag filter chips), **visibility** toggle on create/edit (`private` | `household`; lock vs users badge on cards), **per-member sharing** on private notes (`NoteSharePicker` checkboxes; `note_shares` junction; shared recipients read-only with “Shared with you” badge), author + timestamp footer; `GET /notes` returns own private + shared-with-me + all household notes; `GET /notes/tag-suggestions`; POST/PATCH accept `title`, `pinned`, `tags`, `visibility` + `sharedMemberIds`; PATCH returns updated `note` DTO with `title` / `pinned` / `tags` / `isOwnedByMe` / `sharedWithMe`; parity matrix `docs/NOTES_PARITY.md`; migration `0026_notes_title_pin`.
- **Tests:** `apps/web/src/lib/color-contrast.test.ts`, `apps/web/src/lib/markdown.test.ts`, `apps/web/src/lib/note-visibility.test.ts`, `apps/api/src/lib/notes.test.ts`, **`apps/api/src/lib/expenses.test.ts`** in Vitest.
- **Docs:** `docs/UI.md`

### Core module

- API: `/api/core/weather` — `date`, `dayHourly`, `cached`, `source`, errors (`forecast_unavailable`, `location_outside_us_fallback`, `needsLocation`); `/api/core/chores/glance`; extended `/api/school/glance`; dashboard notice + home status PATCH; profile `temperatureUnit`, `pushNoticesEnabled`, `pushCalendarRemindersEnabled`, `pushChoresRemindersEnabled`, **`pushExpenseBudgetAlertsEnabled`**; **`GET/PATCH /household/settings`** (owner/admin — name, slug, timezone, read-only `modulesEnabled`); `/api/core/push/*` subscribe + VAPID public key; Web Push on new notice; shopping/chores/notes/expenses CRUD (`apps/api/src/routes/core.ts`); expenses also **`GET /expenses/category-suggestions`**, **`GET /expenses/reports`**, **`DELETE /expenses/:id`**, PATCH returns `expense` DTO, **`/expenses/budgets`** CRUD + spend summary, POST/PATCH expense triggers budget alert check; shopping also exposes suggestions, aisle-suggestions, recurring CRUD, clear-with-trip/receipt/expense, reports, serialized `aisle`/`tags`/`quantity`/`unit`/`notes`/`cost`, and legacy bulk delete checked; chores exposes tag-suggestions, **list-suggestions**, recurring CRUD, **`POST /chores/:id/make-recurring`** (promote open one-off → template; 409 if already recurring or completed), karma (`GET /chores/karma`), reports (`GET /chores/reports`), serialized `list`/`tags`/`priority`/`assigneeMemberId`, extended PATCH with completion karma payload; notes exposes visibility-filtered list (own `private` + `note_shares` + all `household`), optional `q`/`tag` query filters (`q` matches title + content), pinned-first sort, `GET /notes/tag-suggestions`, POST/PATCH `title` + `pinned` + `tags` + `visibility` + `sharedMemberIds`, serialized note DTO with `title`/`pinned`/`tags`/`isOwnedByMe`/`sharedWithMe`; **`GET /household/roster`** (all members — memberId + label for share/assignee pickers).
- DB: migrations `0007`–`0027` (through `0014` calendar categories/reminders; `0019`–`0020` shopping quantity + expansion; `0021` chores expansion; `0022` chore karma/completions; `0023` notes `visibility` + `created_by_user_id`; `0024` `note_shares`; `0025` notes `tags_json`; `0026` notes `title` + `pinned`; **`0027` `expense_budgets` + `expense_budget_alert_sent` + `users.push_expense_budget_alerts_enabled`**). Journal includes `0013_event_categories_reminders` before `0014` (was missing — fresh DBs failed on `0014` ALTER).
- UI: interactive `/dashboard`, `/shopping`, `/shopping/reports`, `/chores`, `/chores/reports`, `/notes`, `/expenses`, `/expenses/reports`.

### School module

- API: classes CRUD (PATCH term/teacher/schedule/archived), enrollments, assignments CRUD (incl. `categoryId`, `allowLate`), **`GET /classes/:id/gradebook`**, categories CRUD, submit, grade, artifacts (`school.ts`); **`GET /api/school/context`** + role-scoped **`GET /classes`** / **`GET /glance`** (archived excluded by default); per-route **`access`** object from `apps/api/src/lib/school-access.ts` (household role + enrollment role).
- UI: **role-aware** (WHO-47) — view banner on `/school`; admin/staff see create class + full roster/gradebook; **student** sees enrolled classes only, own progress, submit workflow, no teacher actions; **observer** read-only. Assignment sheet includes **Allow late submissions** toggle (default on), category picker when categories exist.
- Routes: `/school`, `/school/reports`, `/school/class/[id]`, `/school/class/[id]/gradebook`, `/school/assignment/[id]` — conditional sections per `SchoolClassAccess`; assignment detail uses kid-friendly student turn-in flow (unified work card, plain-language status, upload-first with artifact preservation on save); **past-due turn-in allowed** (`allow_late` default true; `POST …/submit` sets `is_late` when `submitted_at` > `due_at`; UI overdue/late badges); teachers get **Student work** card with file list, image previews, and `GET /api/school/artifacts/:id/file` for authenticated download/view.
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

- CLI `npm run import:homehub` with `--dry-run`, `--strict`, optional `--config` (defaults to `config.yml` beside `--sqlite`).
- **HomeHub `config.yml` required** for live import — member roster, claim emails (`auth.display_names`, `allowed_emails`), admin roles (`admin_emails`), school students; migration `0018` adds `users.import_claim_email`.
- Mappers: **notices**, **todo_item** (+ chore), **`note`** → `notes` (content, title from optional SQLite column or first content line, creator display name, `timestamp` → `created_at`; optional `tags`/`visibility` when SQLite has them; default household visibility), **personal_calendar**, **unified household members** (`home_status` + config-only stubs e.g. Riley), school artifacts, files→S3, full school LMS rows.
- Bulk `import_records` index for fast re-import; progress on stderr; `closeDb()` on CLI exit.
- `docs/IMPORT_REPORT.example.json` regression baseline (fixture dry-run).
- Real droplet `app.db` gate: operator copies DB + `config.yml` per `docs/HOMEHUB_IMPORT.md` (not automated in CI). **Local dogfood import verified** on `data/app.db`.

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
| Real `app.db` import counts | validated on **extended fixture** + **local dogfood `data/app.db`** | Droplet staging/prod import still operator-run |

## Immediate next steps (operator)

1. Staging rehearsal: `docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml up` → `./scripts/smoke-cutover.sh` → browser module smoke.
2. Prod import + Caddy swap per `deploy/CUTOVER.md`; copy droplet `app.db` + **`config.yml`** + `uploads/`.
3. 48h soak before stopping HomeHub.

## Module enablement (default)

```
MODULES_ENABLED=core,school,calendar_sync
```
