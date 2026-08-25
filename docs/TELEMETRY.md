# Telemetry — opt-in, anonymized metrics

**Off by default on every deployment mode, self-host and hosted alike.** An owner/admin
turns it on per household in **Settings → Privacy**. This doc is the technical reference;
the user-facing commitment is in [Privacy Policy](../packages/marketing-ui/src/legal.tsx)
§ "Optional anonymized metrics" — read that first if you're changing what gets collected,
since the two need to stay in sync.

## What this is not

- Not tied to any household, user, or account. `telemetry_events` / `telemetry_bug_reports`
  (`packages/db/src/schema/telemetry.ts`) have no `household_id`/`user_id` column at all —
  that's a structural guarantee, not a query-time filter.
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
| `error` | `window.onerror`, unhandled promise rejections | Message only, truncated to 256 chars — no full stack today |
| `usage` | Fixed-taxonomy event names (e.g. `chore.completed`) | Counts/names only — never note/health/expense/event *content* |

Every event also carries: an `anon_id` (random UUID, generated client-side on first opt-in,
stored in `localStorage` under `domi-ops:telemetry-anon-id` — regenerated if opted out then
back in, so there's no resumed history), route `path` (path only, never query string or
full URL), `deployment_mode`, `app_version`.

**Adding a new usage event:** call `trackEvent("usage", "module.action", { metadata: {...} })`
from `apps/web/src/lib/telemetry.ts` at the point of the action. Keep `metadata` to small
structured fields (numbers/strings/booleans, ≤10 keys) — never free text, never anything a
household member typed. The API route caps and validates this shape server-side regardless
(`apps/api/src/routes/telemetry.ts`), but don't rely on that as the only guard.

**Instrumentation today is intentionally minimal** — Web Vitals and JS errors are wired up
everywhere (`AppChrome.tsx` boots collection once per session when opted in); usage-event
call sites are not yet added at feature action points. That's a deliberate, scoped-down v1,
not an oversight — add call sites as they become useful, not preemptively everywhere.

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

Typecheck/build/test pass across the monorepo. The ingest route's hand-rolled validation
(size caps, enum allowlists, metadata field limits) is unit-level defensive coding, not yet
covered by an automated test — if this route sees real traffic, that's the first gap to close,
alongside the "no rate limiting anywhere in this codebase yet" gap already flagged for
`POST /api/billing/checkout`.
