# Gemini private synthetic evaluation (WHO-477)

WHO-477 evidence below is **synthetic-only**. WHO-478's owner-approved policy
now permits reviewed Gemini native-data pilots with explicit training/review/
retention disclosure and fresh member consent, instead of a blanket provider ban.
No real Gemini pilot or deployment has been performed. Keep unapproved profiles
disabled; follow [setup](MCP_SETUP.md) and [provisioning](MCP_PROVISIONING.md).
Hosted MCP remains included in the base price and self-hosted MCP remains free;
pricing does not override the client data-handling policy. Gemini API, CLI,
business accounts and consumer apps are separate surfaces requiring their own
review and evidence. See [M1 decisions](MCP_M1_DECISIONS.md).

## Account and connection setup

Google's [custom-app help](https://support.google.com/gemini/answer/17209137)
currently requires a personal Google account, US adult eligibility, English and
Keep Activity enabled. Setup is on the web; documented mobile availability is
not a mobile test receipt. Recheck these requirements before evaluation. Never
enable a privacy setting automatically to make the test eligible.

Use a separate owned lab and public HTTPS canonical origin following the
[synthetic lab instructions](MCP_CLAUDE.md#separate-synthetic-lab), with a distinct
worktree and unused seven-port range. The endpoint is `/api/mcp`. An OpenAI
private tunnel or a LAN-only address cannot serve Google's remote client.
Preserve TLS, canonical Host, resource and audience checks. Forward only the
synthetic app port; expose no provider fixture, database or fixture-guide ports.

In Gemini's Connected Apps, choose **Create custom app**, enter the endpoint,
then expand **Additional settings**. Pre-registered client ID and optional secret
fields are available. Domi Ops does not enable dynamic registration or CIMD.
Register only an exact callback supplied by the actual client. Google's
[account-linking documentation](https://developers.google.com/identity/account-linking/oauth-linking)
describes the production relay `https://oauth-redirect.googleusercontent.com/r/…`;
it does not supply this account's exact Gemini callback. Do not infer it or use
a wildcard, another user's URL or a generic-client profile. If copying produces
a rich link, verify its destination; the displayed label may be the MCP endpoint.

The QA-only helper accepts the observed callback from a file mounted inside the
tools container. With the owned project's ignored Compose environment:

```powershell
docker compose --project-name YOUR-OWNED-PROJECT --file docker-compose.qa.yml --env-file .qa/hosted/compose.env run --rm --volume "ABSOLUTE_CALLBACK_FILE:/tmp/gemini-callback:ro" tools node scripts/mcp-gemini/register-client.mjs /tmp/gemini-callback
node scripts/mcp-chatgpt/smoke.mjs
```

Registration requires the public synthetic lab guards and creates a distinct
`gemini` / `synthetic` profile with PKCE public-client authentication and only
`shopping:read chores:read notes:read offline_access`. The QA helper remains
synthetic-only. Household profiles require operator review, explicit enablement
and fresh member consent before real-data access. Metadata stays in the QA volume;
console output omits the account-bound callback path. A differing existing client
requires inspection instead of replacement. Registration does not establish that
Gemini completed the public-client flow. Enter the returned client ID in Gemini
and leave the secret blank for this test.

Google's connection warning describes possible sharing of other app, skill and
Google Account context. Review that warning before accepting it. Use an explicit
fictional-data-only prompt, no other connectors or personal context, and never
copy real household credentials into this lab. Domi Ops consent still requires
an adult member, selected notes and explicit scopes. Calendar, School, Health,
Drive and writes remain excluded. Hosted entitlements and household isolation
are not bypassed by client installation.

## Portable skill import

Google's [skill import instructions](https://support.google.com/gemini/answer/17094296)
accept a ZIP with `SKILL.md` at its root. Generate the shared source unchanged:

```powershell
New-Item -ItemType Directory -Force .qa/gemini | Out-Null
node scripts/mcp-gemini/package.mjs .qa/gemini/NEW-SKILL
Compress-Archive -Path .qa/gemini/NEW-SKILL/* -DestinationPath .qa/gemini/NEW-SKILL.zip
```

The folder contains only the portable briefing and MIT license, byte-for-byte.
It has no connection manifest, endpoint or credentials and refuses replacement
of an existing directory. In Gemini choose **Skills → Create → Upload → files**,
select the ZIP, review the imported instructions, then **Save skill**. The initial
Upload menu opens a dropzone; its files button opens the actual chooser.
Importing this file does not connect a server or grant access. The actual installed
skill must still be tested with the synthetic connection, context first, bounded
reads, household-local dates, exact record links and explicit missing coverage.
Keep unrelated personal skills and context out of the test request. No scripts
or external-action workaround is included.

In a fresh conversation, type `@Domi` and select the installed briefing from the
Skills menu before entering the request. Merely naming the skill in a prompt
reported a storage error in this evaluation; selecting the actual skill showed
the Skills indicator and applied its missing-connection workflow. This establishes
invocation, not successful household retrieval.

## Current evidence and remaining acceptance

2026-10-22: actual consumer Gemini completed public-client PKCE S256 and selected
fictional-note consent, exchanged the authorization code (HTTP 200), initialized
with **2025-11-25**, sent initialized notifications (HTTP 202), and listed tools
(HTTP 200). The UI reported **connected and ready to use**. Its HEAD/GET probes
received 405 without preventing this setup. No persistent/GET transport is needed.

The initial modern-only gateway rejected this client with HTTP 400. The gateway
now uses the official SDK's [stateless legacy compatibility](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md)
alongside modern requests. Both paths retain the same bearer, grant, scope, tenant,
rate, size and deadline checks and fresh server factory. Restricted-role tests
cover 2025-03-26/06-18/11-25 through the Next bridge in single/shared modes. The
public modern five-read/refresh/disconnect preflight, typecheck (17 tasks), and
full QA image rebuild pass. The preflight's local inspector is **not live Gemini
household-read acceptance**; all 20 package/registration/QA checks also pass.

The unchanged skill ZIP imported and saved Active with its source and MIT license.
Explicit `@` selection showed the installed Skills indicator and applied its
missing-connection instructions. A prompt naming the skill alone had reported a
storage failure; do not treat that model self-report as proof of a storage defect.
The first access-only connection was unavailable to conversations. After refresh
discovery and fresh app creation, both the skill and connector appeared in the
`@Domi` menu. Selecting both produced a real briefing: the server recorded context
first, then shopping, chores, selected-note listing and the selected-note text,
all successful. The saved reply used the correct household date/timezone, persisted
fixture records and exact app links, disclosed excluded domains and no writes.

The observed authorization requested the three reads but no `offline_access`, and
no refresh credential was issued. Google's [account-linking token contract](https://developers.google.com/identity/account-linking/your-api-reference)
requires a refresh token for code exchange. Protected-resource discovery now
advertises `offline_access` alongside the reads, matching the provider's existing
resource allowlist. This only advertises support: a fresh explicit request and
member consent are still required. No refresh is issued to an access-only request,
and an existing grant cannot be broadened through scope reduction.

Retrying the saved app after updated scope discovery still requested only the
three reads, with neither `offline_access` nor `access_type=offline`; this request
was declined without issuing another grant. The saved app offers Delete but no
scope editor. With explicit user approval, only that synthetic Google connector
was removed/unlinked, and a fresh setup was prepared using the same endpoint and
registered public client. The fresh authorization then requested all four scopes,
including `offline_access`. Explicit selected-note consent issued a refresh token;
Google rotated it four times while completing the real five-read briefing. The
old saved configuration did not adopt the changed scope advertisement on reconnect.

That fresh manual linking completed. Google's embedded
notice has been blank for both browser controls and the user; manual completion
reaches Domi Ops. The exact user-observed relay callback is registered idempotently;
account-bound paths stay private. Keep Activity was already on and unchanged.
Temporary owned-gateway diagnostics record only allowlisted methods/paths/statuses,
version fields, bearer presence and numeric/static errors, excluding query strings,
credentials and household/tool contents. Other labs and the original OpenAI tunnel
remain untouched.

Live domain reads, refresh rotation, reauthorization and the installed briefing
are verified. Removing chore scope in Domi Ops blocked the next actual Gemini
read: refresh was refused and Gemini reported the tool unavailable without reusing
data. Product Disconnect then revoked the grant and all five refresh credential
records; the next Gemini request reported context unavailable and returned no data.
Scope reduction had already removed the client's tool access before Disconnect,
so the final reply is not an independent before/after test of revocation alone;
the restricted-role regression suite separately isolates revocation enforcement.
Mobile, Gemini API/CLI, real-household use,
production deployment and vendor listing are also unverified.

When testing finishes, revoke any Gemini grants, stop the owned temporary tunnel,
and stop only this checkout's stack with `node scripts/hosted-qa/run.mjs down`.
Keep private callbacks, account IDs, screenshots and logs in ignored QA artifacts.
This evaluation ended with zero live Gemini refresh credentials, the owned tunnel
stopped and this checkout's lab stopped; volumes and private receipts are retained.
