# Telemetry — opt-in product metrics

**Off by default on every deployment mode, self-host and hosted alike.** An owner/admin
turns it on per household in **Settings → Privacy**. This doc is the technical reference;
the user-facing commitment is in [Privacy Policy](../packages/marketing-ui/src/legal.tsx)
§ "Optional anonymized metrics" — read that first if you're changing what gets collected,
since the two need to stay in sync.

## What this is not

- Not tied to any household, user, or account. `telemetry_events` / `telemetry_bug_reports`
  (`packages/db/src/schema/telemetry.ts`) have no `household_id`/`user_id` column at all —
  that avoids a direct account key, but is not a guarantee of formal anonymization.
- Not sold, not shared beyond "used to find bugs and decide what to build next" (see the
  Privacy Policy wording — that line is a product commitment, keep code and docs matching it).
- Not required for the app to function. Every call site fails silently (`.catch(() => {})`)
  — telemetry must never be why something breaks for a household.

## Architecture

```
Browser (self-host OR hosted)
  → apps/web/src/lib/telemetry.ts (queued, flushed every 10s or on page hide via sendBeacon)
  → POST {TELEMETRY_ENDPOINT}/events | /bug-report
  → apps/api/src/routes/telemetry.ts (unauthenticated, CORS: origin "*" — see apps/api/src/index.ts)
  → telemetry_events / telemetry_bug_reports tables
```

**One central collector for every install.** `TELEMETRY_ENDPOINT` defaults to
`https://app.domi-ops.com/api/telemetry` for both self-host and hosted — self-host has no
local place to aggregate cross-install product insight, so an opted-in self-host instance
phones home to the same collector hosted households already write to directly. This is a
real, deliberate design choice for an OSS project — say so plainly if anyone asks, don't
let it be a surprise found by reading the network tab.

Operators can override `TELEMETRY_ENDPOINT` in `.env` (point it at their own collector, or
anywhere) — see `.env.example`. The override only matters once a household opts in; it does
not itself enable anything.

## What's collected

| Kind | Examples | Notes |
|------|----------|-------|
| `web_vital` | LCP, CLS, INP, FCP, TTFB | Via `web-vitals` npm package, lazy-imported only when opted in |
| `error` | `browser_error`, `unhandled_rejection` | Fixed categories; raw messages and reasons are discarded |
| `usage` | Fixed-taxonomy event names (e.g. `chore.completed`) | Counts/names only — never note/health/expense/event *content* |

Every event also carries: an `anon_id` (random UUID, generated client-side on first opt-in,
stored in `localStorage` under `domi-ops:telemetry-anon-id` — regenerated if opted out then
back in, so there's no resumed history), coarse module `path` (such as `/school`,
without record IDs, query strings or full URLs), `deployment_mode`, `app_version`.

**Adding a new usage event:** extend the fixed taxonomy in
`packages/config/src/telemetry-privacy.ts` and call `trackEvent` at the action. The
shared client/collector policy drops unknown names and arbitrary metadata. Only
allowlisted Web Vitals ratings survive as metadata. The API caps request bodies at
64 KiB and batches at 50 events. This is not a substitute for edge abuse controls.

Web Vitals, fixed browser error categories and module page views are wired in
`AppChrome.tsx` only when opted in. Disabling removes event listeners, drops the
queue and deletes the browser ID. Explicit feedback uses a new ID per report so
its optional email is not joined to metrics. Sentry diagnostics are configured
separately, with shared allowlist scrubbing, no performance traces/breadcrumbs and
no request bodies, headers, user context, SQL parameters or attachments.

The separate operator activation report uses opted-in hosted households and emits
monthly counts without IDs or contents, suppressing cohorts under five. See
[HOSTED_MEASUREMENT.md](HOSTED_MEASUREMENT.md) for population and retention limits.

## Bug reports are a separate consent, not gated by the toggle

`apps/web/src/components/FeedbackCard.tsx` (on `/profile`, available to every member
regardless of role or the household's telemetry setting) posts to `/bug-report` directly.
Submitting one is its own one-time, user-authored action — treat it differently from
passive background metrics in any future change here.

## Database

- `packages/db/src/schema/telemetry.ts` — no RLS (matches `stripe_events`, 0054 — nothing
  to scope by, no `household_id` column exists to write a policy against).
- Migrations: `0059_telemetry_opt_in.sql` (adds `households.telemetry_opt_in`),
  `0060_telemetry_events.sql` (the two tables).
- `households.telemetry_opt_in` — the actual on/off switch, per household. Read via
  `/auth/session` (`telemetryOptIn`, visible to every member so the client knows whether to
  boot collection) and `/api/core/household/settings` (owner/admin read+write, same
  `canProvisionMembers` gate as every other household setting).

## Verified

Collector tests verify body bounds, fixed categories, metadata and record-path
removal, and separately authored feedback. Client tests verify opt-out drops the
queue, re-opt-in rotates the ID and listeners do not multiply. Shared policy tests
verify value bounds and taxonomy. A real Sentry SDK test captures an in-memory
transport envelope and verifies private text, SQL parameters and attachments are
absent. Production proxy abuse controls, retention and processor configuration
still require operator receipts; these tests send no live Sentry events.
