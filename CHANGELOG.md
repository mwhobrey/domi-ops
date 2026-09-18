# Changelog

All notable changes to Domi Ops are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) — see [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md).

This file starts tracking from 2026-08-30. Earlier history lives in `git log` and closed Linear issues.

## [Unreleased]

### Added

- Browser + Next.js server Sentry for `apps/web` (`@sentry/nextjs`, WHO-292) — reuses
  runtime `SENTRY_DSN` on the web container; `error.tsx` / `global-error.tsx` report to Sentry.
- Capacitor 8 store shell (`apps/mobile`, `appId: app.domiops`) with Bitwarden-style server URL
  picker, `/api/healthz` probe (CapacitorHttp), and remote WebView of live `apps/web` (ADR 005 /
  WHO-287). Native Google + Sign in with Apple idToken exchange, APNs/FCM push (FCM HTTP v1),
  RevenueCat → `household_subscriptions`, Profile account deletion for store compliance
  (WHO-288–291). See `docs/native-mobile-store-spike.md` and `store-assets/CHECKLIST.md`.
- Medication reminder groups: bundle several household medications under one shared schedule so
  recipients get a single consolidated push notification instead of one per medication, plus a
  dedicated `/health/medications` manager page.
- Per-route `loading.tsx` skeletons across the app, matching each page's real layout to avoid a
  layout jump when the real content streams in.
- Issue templates, PR template, Code of Conduct, and this changelog.
- Event type filter on the Health Events tab, matching the filter already available on the
  Events report — previously the only way to narrow the feed by type (WHO-294).
- Exercise and pain tracking in the Health module (WHO-297/298/299): dedicated "Log exercise"
  and "Log pain" quick-log buttons alongside the existing "Log vitals", each opening a
  purpose-built sheet — pain logging taps a front/back body map instead of typing a location.
  Both types are also fully editable via the general "Add event" form for backdating, same as
  vitals already was.
- Exercise and pain report kinds (WHO-301): "Exercise" shows weekly workout volume and a
  by-activity minutes breakdown; "Pain" shows a body-region frequency heatmap (reusing the
  `BodyPainMap` diagram in read-only mode) and severity-over-time per region. Both are
  selectable from the Health reports picker and support the same print/CSV/JSON/YAML export
  as every other health report.
- Schedule Conflict Checker (WHO-308): a dashboard widget that checks a date/time (or range)
  for overlapping calendar events and medication doses due in that window. Overlapping events
  are flagged red; events whose own manually-entered drive-time buffer encroaches on the
  checked window are flagged yellow; meds due in the window are shown as informational only.
  New optional per-event `driveBufferBeforeMinutes`/`driveBufferAfterMinutes` fields (manual
  entry — no maps/geocoding integration) are editable from the event sheet's "Drive buffer"
  section and used automatically when that event is checked. New `GET
  /api/schedule-conflicts/check` endpoint. *(requires `npm run db:migrate`; no other manual
  steps for self-hosters.)*

### Changed

- Health Events tab renamed to Log, with the type dropdown replaced by filter chips that only
  show types you've actually logged, instead of all nine every time (WHO-300).
- Medication editing consolidated to one place: the Health Medications tab is now the full
  manager (groups, day timeline, schedule editor) instead of a separate quick-edit list that
  linked out to `/health/medications` for anything more. That page is now a redirect back to
  `/health` (WHO-302).
- New Health **Trends** tab: vitals, exercise, and pain charts inline on `/health` instead of
  only in Reports — the same "is BP trending up" gap now closed for exercise volume and pain
  severity too (WHO-303).
- Nutrition tracking: a `food_intake` health event type with one or more food entries per meal
  (name, quantity, calories, protein/carbs/fat) — manual entry only, no food database. Dedicated
  "Log meal" quick-log button alongside Log vitals/exercise/pain, plus full editing via the
  generic "Add event" form for backdating (WHO-304/305). New "Nutrition" report kind (daily
  calorie trend + protein/carbs/fat breakdown) in both the Reports hub and the Health Trends tab
  — same running-totals treatment as vitals/exercise/pain, not just a food journal (WHO-306).
  This closes out Phase 3 of the Health module expansion.
- Split several large files (`apps/api/src/routes/core.ts`, `apps/api/src/routes/school.ts`,
  `HealthPageClient.tsx`, `SchoolClassDetail.tsx`) into focused modules for maintainability.
- Health Today tab's "Logged today" list is now grouped by household member with a collapsible
  header, matching the grouping "Scheduled doses" already had (WHO-295).
- PRN meds on the Health Today tab moved from a card at the bottom of the page to a searchable
  quick-log at the top — type or tap a med to log an as-needed dose in one action instead of
  scrolling past the scheduled dose queue to reach it (WHO-296).

### Fixed

- Interval medications with a multi-day cadence (e.g. once every 7 days) no longer reappear every
  morning at the start time; next dose is last taken + interval across days
  (`packages/calendar-sync/src/med-interval-schedule.ts`).
- Calendar med overlays prefer medication **groups** over member meds, omit already-logged doses,
  and keep overdue untaken doses. At-a-glance calendar tile no longer lists meds (health tile does)
  and hides past timed events; dashboard agenda hides past timed events.
- The `/health` page was unreachable in production due to a Caddy routing rule that shadowed it
  with the API's own liveness endpoint.
- Scroll jank on iOS (Safari and Chrome, both WebKit): dropped `backdrop-filter` from the sticky
  header, calendar toolbar, calendar agenda day headers, health sharing bottom bar, and the drive
  drag-and-drop overlay, since WebKit recomputes the blur every scroll frame instead of caching it.
- Hosted checkout no longer forks a signed-in user's account: a signed-in user who finishes
  checkout is attached to their household by their session identity, not the email typed into
  Stripe Checkout, and a repeat checkout by someone who already has a household is sent to the app
  instead of creating a second subscription. A mismatch between the login and the Checkout email
  used to spawn a second account and household that could never reach the app.
- A household member with write access to another member's private health events/medications —
  not just the record's creator — no longer silently clears its shares when editing and saving.
  The API previously only returned real share state to the creator; a non-creator editor saw an
  empty share list and unknowingly overwrote it on save (WHO-293).
- The Health Events "Event type" filter (report + tab) silently dropped Exercise/Pain since
  neither was in the type-label map the filter validates against; both were also missing from
  the report filter's own dropdown options.
