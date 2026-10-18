# Local hosted QA

This lab runs the real production-mode app, marketing pages, API, Better Auth,
restricted-role PostgreSQL/RLS, worker/Redis, private MinIO files and captured SMTP
email. Synthetic households and a local Stripe simulator make the default run
repeatable without provider accounts. It does not access production or dogfood.

## Start and test

Prerequisites: Docker Compose v2, the pinned Node runtime (`mise`), `npm ci`, and a
Playwright browser. Windows uses installed Edge by default. Elsewhere run
`mise exec -- npx playwright install chromium`, or set `PLAYWRIGHT_CHANNEL`.

```text
mise exec -- npm run qa:hosted
```

The first run builds one shared QA image. Later builds reuse Docker layers. The
only new service dependency is Mailpit, pinned to `axllent/mailpit:v1.31.6`; Compose
pulls it automatically (`docker pull axllent/mailpit:v1.31.6` to prefetch).

The command starts an isolated stack, migrates both source and empty archive
databases, creates the restricted app roles, seeds fixtures, runs unit and hosted suites,
drives real browser flows, checks a worker job and rehearses the archive CLI with
different encryption keys and real private objects. It leaves the lab running for
manual testing. Failures retain service logs and browser screenshots.

Default addresses:

| Service | URL |
| --- | --- |
| Application | http://localhost:13180 |
| Marketing and checkout | http://localhost:13181 |
| Captured email | http://localhost:13182 |
| Local provider / fixture guide | http://localhost:13183 |

Use `localhost` consistently for browser cookies. Before initial setup, set
`DOMI_QA_BASE_PORT` to choose another block of seven ports. An occupied port is an
error; the harness never stops an unrelated process to make room.

Owner accounts: `alpha@hosted-qa.example.test`, `beta@hosted-qa.example.test`, and
`expired@hosted-qa.example.test`. Student username: `qa_student`. Synthetic password:
`HostedQa2026!`. The fixture guide lists current identities. Do not reuse this
password or store real household records in the lab.

## Lifecycle and isolation

```text
mise exec -- npm run qa:hosted:up       # start/build; retain existing QA data
mise exec -- npm run qa:hosted:test     # run checks against the running fixture lab
mise exec -- npm run qa:hosted:status
mise exec -- npm run qa:hosted:logs
mise exec -- npm run qa:hosted:down     # stop; keep named volumes
mise exec -- npm run qa:hosted:reset    # remove only this lab's containers/volumes
```

Use `-- --no-build` with `qa:hosted:up` only when deliberately reusing the current
image. Default startup builds the current checkout. Reset is confined to a project
derived from the checkout's absolute path; state, Compose-file ownership and volume
labels are checked first. A command lock prevents concurrent reset/start/test.
It never calls the normal dev reset command, global Redis flush or normal Compose
project. `.qa/hosted/` is excluded from Git and Docker build context; it holds lab
secrets, configuration, receipts and screenshots. Reset preserves those receipts.

Default application and infrastructure networking is internal-only. A gateway
exposes fixed service destinations on loopback; it has no application credentials.
Services use no checkout `.env`, live keys, production database or shared Redis.
The app has a separate authentication-cookie prefix so manual QA logins do not
replace normal localhost development sessions.
Startup waits for MinIO readiness. Provider fixture registration has a 15-second
timeout and runs inside the seed transaction, so a failed registration rolls back
the database seed and can be retried. Simulated checkout completion and webhook
delivery are persisted separately; posting the checkout again retries failed
delivery without creating another subscription. Worker checks remove their own
generated calendar, rule and events after each run, including failed runs.
Cleanup attempts every remaining step even if deletion or a resource finalizer
fails, then reports aggregated cleanup errors with the original check error as
their cause. Restore storage prefixes are independent cleanup steps; a failed
object deletion does not skip other objects or pages. A failed listing retains
earlier deletion errors and still allows later prefixes and finalizers to run.
A success receipt is emitted only after teardown completes.
MyAllyFile points to a disabled local endpoint; Withings, Sentry, push and optional
metrics are not configured. The admin database password is supplied only to the
one-shot setup tools; application and worker use a NOBYPASSRLS non-owner role.

The simulator exercises application checkout requests, signatures, webhook
provisioning, portal entry, scheduled cancellation, expiry and paid restart. It is
not a Stripe implementation or evidence of Stripe dashboard/store configuration.
Google consent/review, real push delivery, native purchases, public HTTPS/cookies
and customer usability remain separate acceptance work.

Automated browser contexts use America/Chicago with an explicit locale while the
server runs in UTC. Hydration errors fail the run, including billing dates rendered
in different timezones. The hosted suite runs in test mode inside the QA image;
the application itself keeps production authentication and subscription checks.
The suite's legacy Alpha/Beta fixtures are separate from the interactive households.

## Optional provider acceptance

Copy `scripts/hosted-qa/providers.env.example` to `.qa/hosted/providers.env`. Use a
separate Google Cloud project in Testing, with a Web application client and these
callbacks registered for the chosen app port:

```text
http://localhost:13180/auth/callback/google
http://localhost:13180/auth/google/calendar/callback
http://localhost:13180/auth/google/docs/callback
```

Add your test accounts and enable Calendar/Drive/Picker as needed. See
[Google setup](GOOGLE_OAUTH_SETUP.md). This harness does not create credentials or
change the production OAuth project. Testing integration grants can expire after
seven days ([Google token-expiration rules](https://developers.google.com/identity/protocols/oauth2/#expiration));
local tests do not establish production verification.

Stripe is optional: leave its settings blank to retain the simulator. For real
sandbox acceptance, supply a `sk_test_` key, both sandbox prices and the signing
secret printed by `stripe listen --forward-to localhost:13180/api/billing/webhook`.
The harness refuses live secret keys.

```text
mise exec -- npm run qa:hosted:providers
```

This explicit mode permits outbound networking and launches the app for interactive
provider acceptance. SMTP remains captured locally. Automated tests refuse provider
mode. `qa:hosted:up` switches back to the isolated fixture environment; provider
credentials stay only in ignored configuration. Do not enable live billing,
production credentials or real household data in either mode.

## Verified locally (2026-10-17)

- 1,419 unit/non-database tests and 803 hosted integration tests passed in the QA
  image. All browser journeys, worker execution and encrypted archive/private-file
  restoration passed, including a repeat run after retaining and restarting data.
- Browser checks caught and verified a fix for subscription-date hydration errors
  between a UTC server and a Chicago browser. Upload checks verify actual stored
  bytes; billing checks perform writes before expiry and after paid restart.
- Down retained data; reset after down removed all five owned volumes; a clean
  startup created new synthetic households. Original dev Postgres/Redis container
  IDs and running state were unchanged. Concurrent reset was rejected.
- Missing credentials and live Stripe keys were refused without changing active
  configuration. Provider-mode startup/return to internal networking passed using
  synthetic Google settings; no real Google authorization was attempted.
- Home, pricing, homeschool and health marketing pages loaded their images at
  mobile width without horizontal overflow. Typecheck and lint passed (lint has
  existing warnings). Ownership guard tests passed and are included in CI.

Local evidence lives under `.qa/hosted/runs/`, with lifecycle checks in
`.qa/hosted/lifecycle.json` and image checks in `.qa/hosted/marketing-assets.json`.
Real Google/Stripe acceptance and a remote beta deployment remain unperformed.
