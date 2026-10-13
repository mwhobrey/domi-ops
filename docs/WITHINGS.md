# Withings blood pressure sync

Operator and developer notes for the Withings integration. Linear: WHO-452 (API and worker),
WHO-453 (screens).

## What it does

A household member can be linked to one Withings account. Blood pressure readings from their Withings
cuff (BPM Connect, BPM Core, BPM Vision) become normal `vitals` entries with systolic, diastolic and,
when the cuff recorded it, pulse. One way only: Withings to Domi Ops.

There is no matcher for scheduled checks. A slot counts as answered when a reading falls inside its
30 minute window ([HEALTH_CHECKS.md](./HEALTH_CHECKS.md)), and an imported reading is a reading, so a
scheduled BP check fills in by itself and an unscheduled one is simply an entry in the log.

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
   parks a single-use state in Redis (10 minutes) bound to the signed-in user.
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

## Link states

| `status` | Meaning | How it recovers |
|----------|---------|-----------------|
| `active` | Syncing | n/a |
| `error` | Eight failures in a row | Fix the cause, then **Sync now** |
| `revoked` | Withings rejected the token (user withdrew access, or the refresh token lapsed) | Unlink, connect again |

## Behaviour worth knowing

- **Duplicates.** One entry per Withings measure group, keyed `(link, grpid)`. Re-delivered webhooks and
  repeated backfills change nothing.
- **Deleted entries stay deleted.** Deleting an imported entry leaves a tombstone row, so a backfill does
  not bring it back. A group Withings reports deleted removes the entry and any check completion on it.
- **Unlinking** keeps everything already imported. It is the person's history now.
- **Token rotation.** Withings retires the refresh token each time it is used, so the new pair is saved
  in the same step as the refresh and survives a failed pull after it.
- **Only blood pressure.** A group needs both systolic and diastolic. A lone pulse (a scale, say) is
  skipped. Entries are private to the person and their `events` grantees, like any health entry.
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

## RLS

`health_withings_links` has `household_isolation` plus a **read-only** `worker_scan` policy: the tick has
to ask which links are due across households. Every write, including the lease and the import, runs per
household under that household's own context (WHO-434). `health_withings_measure_groups` has no
`worker_scan` policy and is on the allowlist in `rls-worker-scan-coverage.integration.test.ts`.

## Not verified against Withings

Written from Withings' public documentation without a live account; confirm on first real use:

- The `status` values mapped to "token will never work again" (`401`, `293`) and to rate limiting
  (`601`). Anything else is retried with backoff.
- Whether `getmeas` with `lastupdate` marks removed groups with `deleted`. The import handles it if so.
- That the webhook's `userid` arrives form-encoded as documented.

## Tests

- `packages/calendar-sync/src/withings-sync.test.ts`: shaping, backoff, client error mapping.
- `packages/calendar-sync/src/withings-sync.integration.test.ts`: import, backfill, incremental pull,
  tombstones, deletes, token rotation, scheduling and tenant isolation, as the RLS app role.
- `apps/api/src/routes/health-withings.integration.test.ts`: who may connect, the callback's state
  rules, the webhook, link management.
- `packages/crypto/src/withings-webhook-token.test.ts`.
