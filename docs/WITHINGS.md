# Withings blood pressure sync

Operator and developer notes for the Withings integration. Linear: WHO-452 (API and worker), WHO-453 (screens).

## What it does

A household member can be linked to one Withings account. Blood pressure readings from their Withings
cuff (BPM Connect, BPM Core, BPM Vision) become normal `vitals` entries with systolic, diastolic and,
when the cuff recorded it, pulse. A Withings watch (ScanWatch) adds blood oxygen, body temperature and
spot heart rate as `vitals` entries, and its workouts as `exercise` entries. One way only: Withings to
Domi Ops. Steps, daily activity and sleep are not imported yet.

There is no matcher for scheduled checks. A slot counts as answered when a reading falls inside its
30 minute window ([HEALTH_CHECKS.md](./HEALTH_CHECKS.md)), and an imported reading is a reading, so a
scheduled BP check fills in by itself and an unscheduled one is simply an entry in the log.

## Withings+ for new accounts

From October 12, 2026 Withings requires a Withings+ membership for a Withings account **created after that
date** to share data with a free-plan API app (their banner: "Withings+ becomes required on the Start for Free
API plan from October 12, 2026 ... Accounts created before that date are unaffected. Enterprise lifts the
requirement for specific use cases."). Domi Ops says so in the panel, in the failed-connect message, in the
marketing FAQ and Health page, and in the terms. No price is quoted anywhere, since Withings' notice gives none.
If this starts costing hosted users, the lever is an Enterprise arrangement with Withings; it is not a code change.
The scope of "free plan" for our app is Withings' call, so confirm which plan each deployment's app is on.

## Turning it on

Each deployment registers its own app at developer.withings.com. Withings needs the callback and
webhook URLs to match exactly, so they are this deployment's `PUBLIC_APP_URL` plus a fixed path:

| Deployment | Callback | Webhook |
|------------|----------|---------|
| Self-hosted household | `https://whome.whobrey.me/api/integrations/withings/callback` | `https://whome.whobrey.me/api/integrations/withings/webhook` |
| Hosted | `https://app.domi-ops.com/api/integrations/withings/callback` | `https://app.domi-ops.com/api/integrations/withings/webhook` |

Set `WITHINGS_CLIENT_ID` and `WITHINGS_CLIENT_SECRET` from that app. Unset, the feature is off and the
API says so (`enabled: false`). It also needs `ENCRYPTION_KEY` (tokens are stored encrypted with it),
`REDIS_URL` (the OAuth state) and the `health` module. The worker must be running.

## How it flows

1. **Connect.** `POST /api/health/withings/links/:memberId/connect` returns a Withings consent URL and
   parks a single-use state in Redis (30 minutes: signing up, subscribing to Withings+ and signing in again can take a while) bound to the signed-in user.
2. **Callback.** Withings redirects to `/api/integrations/withings/callback`. The state must belong to
   the signed-in user who started it, and write access is rechecked. The link is created with encrypted
   tokens, a pull is queued, and the webhook subscription is made. A failed subscription does not fail
   the link: it falls back to the safety net below.
3. **Backfill.** The first pull walks `backfill_from` to now. A reading that lands while it pages is
   caught by the next pull, because the watermark is the first page's `updatetime`.
4. **Webhook.** Withings POSTs to `/api/integrations/withings/webhook?t=<token>`. That only flags the
   link (`sync_requested_at`). The worker's 30 second tick sees the flag and enqueues one job per
   household; the job pulls what changed since the watermark.
5. **Safety net.** A link not pulled for six hours is pulled anyway, so a missed webhook heals itself.

### Webhook security

Withings does not sign notifications. The URL we subscribe with carries an HMAC token naming one link
in one household (`mintWithingsWebhookToken`), and the call is also ignored unless its `userid` matches
the link's Withings user. The token can only ask for a sync. It has no expiry; rotating `ENCRYPTION_KEY`
(or `SESSION_SECRET` when there is no key) invalidates every subscription, and "Sync now" plus the
safety net keep links working until they are re-subscribed.

## The screen

Health, **Checks** tab, panel **Blood pressure cuff and watch (Withings)** (`apps/web/src/components/health/WithingsPanel.tsx`).
The same panel is also on **Settings** and **Profile**, below the MyAllyFile card (`WithingsSettings.tsx`, which
loads the roster and the viewer's permissions the way `MyAllyFileSettings` does). A member who can't open Settings
still reaches it from Profile. Connecting from any of the three returns to Health, Checks with the result banner.
It lists each person the viewer has `events: write` for, and does not render at all when Withings is not
configured on the server (`GET /api/health/withings` says `enabled: false`) or the viewer manages no one.

- **Not connected:** pick how far back to import (30 or 90 days, a year, everything up to 10 years) and
  **Connect Withings**, which sends the browser to Withings to approve access.
- **Connected:** state badge, last synced time, and where the import starts. **Sync now**, **Import history**
  (over a window picked beside it) and **Unlink** (with a confirmation).
- **Coming back from Withings** lands on `/health?withings=<result>` (`connected`, `denied`, `expired`,
  `forbidden`, `already_linked`, `unavailable`, `error`), opens Checks and shows what happened. The parent
  (`HealthPageClient`) holds that message so a data reload or tab switch does not drop it, and it has a
  Dismiss link. The query parameter is removed from the address once read.
- A link that is still importing or waiting on a pull is re-read every 8 seconds. Anything that needs a
  person (disconnected, needs attention) is not polled.

## Link states

| `status` | Meaning | How it recovers |
|----------|---------|-----------------|
| `active` | Syncing | n/a |
| `error` | Eight failures in a row | Fix the cause, then **Sync now** |
| `revoked` | Withings rejected the token (user withdrew access, or the refresh token lapsed) | Unlink, connect again |

## Behaviour worth knowing

- **Duplicates.** One entry per Withings measure group, keyed `(member, Withings user, grpid)`. Re-delivered
  webhooks and repeated backfills change nothing. The key is the person's, not the link's, on purpose:
  unlinking deletes the link, and reconnecting the same Withings account (the way out of a revoked link)
  must not import the whole history a second time.
- **Deleted entries stay deleted.** Deleting an imported entry leaves a tombstone row, so a backfill or a
  reconnect does not bring it back.
- **Not mirrored from Withings.** Withings' published group schema has no "deleted" flag, so a reading
  removed in the Withings app stays in Domi Ops. An edit there is not picked up either: a group is
  imported once, by its id, and `modified` is not compared.
- **Whose reading it is.** Groups Withings marks `attrib` 1 (captured by a device but "may belong to other
  users as well as this one") or 4 (entered during user creation, "may not be accurate") are left out, so a
  cuff shared by a household cannot put one person's reading in another's record. They leave no trace: once
  the person assigns the reading in the Withings app it comes back changed and is imported then. `attrib`
  5 is the blood pressure monitor's computed best value and is imported with the rest.
- **Unlinking** keeps everything already imported. It is the person's history now. It also asks Withings
  to stop notifying, refreshing the access token first when needed (they last about three hours).
- **Token rotation.** Withings retires the refresh token each time it is used, so the new pair is saved in
  its own short transaction the moment the refresh succeeds. The household job does not run inside one big
  transaction (`OWN_CONTEXT_JOBS` in the worker): the lease, the refresh, each page and the outcome are each
  committed separately, and Withings is only called between them. A worker killed mid-sync (a deploy) loses
  at most the page it was importing, never a token it had already been given.
- **Readings that miss a scheduled check.** A reading fills a slot on its own within 30 minutes. One taken
  earlier or later is offered inline on the nearest open check (see "attach prompt" in
  [HEALTH_CHECKS.md](./HEALTH_CHECKS.md)): the person taps Attach or Not this one.
- **What a group becomes.** Each Withings measure group is one `vitals` entry titled "Blood pressure"
  (it has systolic and diastolic) or "Vitals". Measure types kept: 9/10 diastolic/systolic, 11 pulse,
  54 blood oxygen (%), 71 body temperature (Celsius from Withings, stored in Fahrenheit like a typed
  entry). Half a blood pressure pair is dropped; anything else in the group is kept. Skin temperature (73)
  is deliberately not imported: it is not a fever reading. Entries are private to the person and their
  `events` grantees, like any health entry.
- **Workouts.** `getworkouts` needs the `user.activity` scope, which the connect now asks for along with
  `user.metrics`. Each workout becomes an `exercise` entry (title and activity from the Withings category,
  start and end, minutes, distance in km, calories) with `external_source = 'withings'` and the workout id
  in `external_id`. Dedupe and "deleted stays deleted" use the same table as measure groups, under the key
  `workout:<id>`. A link made before the scope existed keeps importing readings but not workouts: the panel
  says so, and the fix is to unlink and connect again. The backfill asks for workouts by date (with a day
  of slack each side), later pulls by `lastupdate`, taken from the measurement watermark minus one day: Withings does not say the two are one clock, and the overlap covers a skew of up to a day and only re-reads (the workout key dedupes). A bigger skew would skip a workout; a workout-specific watermark (WHO-462) removes the assumption.
- **Backfill size.** One pull pages up to 200 pages. A history larger than that fails and retries, which
  is cheap because everything already imported is recognised.

## Where things are

| Area | Files |
|------|-------|
| Tables | `packages/db/src/schema/health.ts` (`health_withings_links`, `health_withings_measure_groups`), migration `0094` |
| Client, import, sync | `packages/calendar-sync/src/withings-sync.ts` |
| Jobs | `withings.sync.scan` (30 s tick), `withings.sync.household`; `queue.ts`, `sync.ts`, `apps/worker/src/index.ts` |
| Routes | `apps/api/src/routes/health-withings.ts` (signed in), `integrations-withings.ts` (callback, webhook) |
| Webhook token | `packages/crypto/src/index.ts` |
| Screen | `apps/web/src/components/health/WithingsPanel.tsx`, `withings-helpers.ts` (copy and state, unit tested), wired in `HealthPageClient.tsx` and `app/health/page.tsx` |

## RLS

`health_withings_links` has `household_isolation` plus a **read-only** `worker_scan` policy: the tick has
to ask which links are due across households. Every write, including the lease and the import, runs per
household under that household's own context (WHO-434). `health_withings_measure_groups` has no
`worker_scan` policy (it carries its own `household_id` for the policy) and is on the allowlist in
`rls-worker-scan-coverage.integration.test.ts`.

## What is and is not verified against Withings

Checked against Withings' published OpenAPI spec and error table:

- `attrib` values and meanings (above); status `343` is "OAuth access token absent or invalid" and `601`
  is "Too Many Requests".
- A group schema with no `deleted` field (so deletes are not mirrored, above).

Not verified, and worth watching on first real use:

- The `getworkouts` request and response shape, the `data_fields` we ask for, and the workout category
  names, all written from Withings' documentation without a real watch to test against. A workout of an
  unlisted category imports as "Workout". Notify application 16 (activity) is subscribed best effort; the
  six hour safety net covers a miss. Blood oxygen and temperature have no subscription of their own, so
  they arrive on the next webhook or the safety net.
- Status `401` and `293` are mapped to "token will never work again" from memory; they are not in the
  table I could read. `342` ("credentials absent or incorrect") is deliberately not mapped, because it can
  mean our own app secret is wrong and that must not flip every link to "reconnect": it retries, then the
  link lands in `error`, which Sync now recovers.
- That the webhook's `userid` arrives form-encoded as documented.
- Whether a blood pressure monitor that reports a computed best value (`attrib` 5) also reports the
  individual readings as separate groups. If so, one session would import as several entries.

## Tests

- `packages/calendar-sync/src/withings-sync.test.ts`: shaping, backoff, client error mapping.
- `packages/calendar-sync/src/withings-sync.integration.test.ts`: import, backfill, incremental pull,
  tombstones, deletes, token rotation, scheduling and tenant isolation, as the RLS app role.
- `apps/api/src/routes/health-withings.integration.test.ts`: who may connect, the callback's state
  rules, the webhook, link management.
- `packages/crypto/src/withings-webhook-token.test.ts`.
- `apps/web/src/components/health/withings-helpers.test.ts`: link states, result messages, error copy.
