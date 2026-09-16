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

### Changed

- Split several large files (`apps/api/src/routes/core.ts`, `apps/api/src/routes/school.ts`,
  `HealthPageClient.tsx`, `SchoolClassDetail.tsx`) into focused modules for maintainability.

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
