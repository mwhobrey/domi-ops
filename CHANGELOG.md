# Changelog

All notable changes to Domi Ops are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) — see [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md).

This file starts tracking from 2026-08-30. Earlier history lives in `git log` and closed Linear issues.

## [Unreleased]

### Added

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
