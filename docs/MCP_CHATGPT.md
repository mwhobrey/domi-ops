# Connect ChatGPT to Domi Ops

WHO-475 provides private client packaging and an isolated local synthetic lab.
Actual ChatGPT web OAuth, all five read tools, rotating refresh credentials,
reconnect/reconsent, product-side disconnect and subsequent actual-client denial
passed with fictional data. The separately installed briefing skill also passed
live standalone and combined-plugin Work runs. This is private synthetic
acceptance, not production or general client certification.
Hosted and self-hosted deployments share the endpoint, consent rules and skill;
hosted base inclusion and free self-hosting are unchanged.

## Hosted and self-hosted onboarding (WHO-478)

On a reviewed deployment, operators enable `MCP_ENABLED=true` and
`MCP_CHATGPT_ENABLED=true` (default off), retaining the restricted runtime role
and canonical public HTTPS origin. For the joint Claude/ChatGPT pilot, retain
`MCP_READ_SCOPES=shopping:read,chores:read`; that setting applies to all assistants
on the deployment. Enable Claude separately with `MCP_CLAUDE_ENABLED`. No new
migration, Cloud broker, session extraction or customer OpenAI API key is needed.

The shared resolver accepts only ChatGPT's stable identity
`https://chatgpt.com/oauth/client.json`, stable callback
`https://chatgpt.com/connector_platform_oauth_redirect`, and managed keys at
`https://chatgpt.com/oauth/jwks.json`. It retains the published `private_key_jwt`
preference through the maintained provider. OpenAI owns those signing keys;
operators do not provision or distribute a secret. Other identities/key URLs are
refused before retrieval. Claude keeps its existing public-client identity.

Our issuer metadata advertises RFC9207 issuer identification and the exact same
issuer as resource discovery. Successful and denied consent redirects carry that
issuer. This enables the stable ChatGPT identity/callback; callback-ID-specific
identities are not silently accepted. DCR and anonymous household reads remain off.
These contracts follow [OpenAI authentication guidance](https://developers.openai.com/plugins/build/auth).

For an adult member:

1. Open Settings → AI Connections; an administrator enables the household.
2. Open ChatGPT plugins, then Add → Add custom MCP server. Enter the instance's
   displayed `/api/mcp` URL and choose OAuth with published identity/CIMD if asked.
   Leave client credentials and request headers empty.
3. Review ChatGPT's notice, then sign in to Domi Ops and personally approve only
   the intended household, permissions and provider privacy/settings disclosure.
4. Use a briefing prompt and review source links. Disconnect in AI Connections
   to stop future reads; this does not erase provider copies.

See [current connection instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt).
Account/workspace restrictions still apply. Setup uses the supported custom
installation flow until a directory listing is approved; no prefilled install
deep link is assumed. Self-hosters use their own reachable HTTPS origin.

For an unregistered, credential-free package, the generator now supports:

```powershell
mise exec -- node scripts/mcp-chatgpt/package.mjs --cimd https://YOUR-CANONICAL-HOST .qa/NEW-CHATGPT-PACKAGE
```

Its default scopes are shopping, chores and refresh. Programmatic generation can
explicitly select a different supported read subset to match deployment policy;
notes are never added by default. See [submission preparation](MCP_CHATGPT_SUBMISSION.md).
The existing manual `provided` and registered-app packaging modes remain available
for historical fixtures. Do not reuse their old client/tunnel settings for WHome.

The approved self-host pilot verified published-identity sign-in plus actual
context/shopping/chore reads on reviewed build 2085226. The installed Work
briefing response hit provider model capacity; that is neither an OAuth failure
nor a completed skill acceptance. Refresh, final revocation, usefulness and hosted
reviewer acceptance remain separate checks. No directory submission is implied.

For private web testing, first create/connect the custom MCP server, then bundle
its actual registered app ID with `--registered` and the shared skill. A raw
remote-MCP ZIP imported privately may offer desktop use only. That private app
mapping is not accepted for public submission: retain the remote `mcp.json` CIMD
draft for the public portal. See [review preparation](MCP_SUBMISSION_REVIEW.md).

## Historical private evaluation requirements (WHO-475)

Reviewed official documentation on 2026-10-22:

- [Authentication](https://developers.openai.com/plugins/build/auth): use discovery,
  PKCE S256, the exact resource audience and an explicitly registered client. Copy
  the exact callback shown by the connection UI; do not guess it. That evaluation
  used manual registration; the optional published-identity path above supersedes
  it for new installations. Anonymous registration and machine grants remain disabled.
- [Plugin packaging](https://developers.openai.com/plugins/build/plugins): the
  portable bundle has root `plugin.json`, `mcp.json` and `skills/`. Its OAuth client
  uses `mode: provided`. Client secrets belong in connection setup, never manifests.
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt):
  test the MCP connection and complete plugin separately, using a reachable HTTPS
  endpoint or Secure MCP Tunnel. A local package is not a public listing.
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels):
  a tunnel needs an authorized Platform organization/workspace association, runtime
  key and healthy tunnel client. OAuth authorization-server reachability must also
  be tested; tunneling MCP alone is not proof that OAuth works.

The actual browser account displayed **Plus**, with Plugins → Add → Add custom MCP
server and Server URL/Tunnel/OAuth controls. This establishes availability on that
web account only. A private synthetic connection completed OAuth and consent;
desktop, mobile and other account/workspace eligibility remain unverified. No account identifiers, credentials
or private screenshots belong in public receipts.

The installed MCP SDK is v2.3.1, protocol2026-07-28. It accepts titles, annotations
and `_meta`, but its `registerTool` implementation does not accept the top-level
`securitySchemes` option shown in OpenAI's SDK examples. The current gateway
authenticates before discovery and publishes the HTTP OAuth challenge. Actual
ChatGPT linking and reauthorization worked on this account without changing that
SDK metadata contract. Do not solve other client mismatches by allowing anonymous household reads,
removing authorization checks or silently enabling legacy transport.

## Start the local synthetic lab

Prerequisites: Docker Compose, repository Node22/npm and installed workspaces.
Use this issue's separate checkout so its project, database, files and ports are
isolated from other worktrees. No normal `.env` or production Compose overlay is
loaded. On a fresh checkout, choose a free seven-port range before first startup:

```powershell
$env:DOMI_QA_BASE_PORT = '17180'
mise exec -- node scripts/hosted-qa/run.mjs mcp
mise exec -- node scripts/mcp-chatgpt/smoke.mjs
```

The existing owned hosted-QA harness supplies three fictional households (Alpha,
Beta and Expired), private notes, a student and synthetic excluded-domain data.
MCP setup adds native shopping/chores, enables Alpha's household opt-in and registers
an explicit **local protocol-driver** public client. It creates no member grant or
ChatGPT connection. The smoke explicitly creates and revokes only its synthetic
member connection. No Google credentials or real provider accounts are used.

For the current lab:

| Surface | Address |
| --- | --- |
| App/login/AI Connections | `http://localhost:17180` |
| MCP | `http://localhost:17180/api/mcp` |
| Synthetic account guide | `http://localhost:17183` |
| Test email inbox | `http://localhost:17182` |

The API/tools use test mode for the existing HTTP-loopback exception. Web/worker
keep their ordinary production runtime. All published ports bind loopback and the
fixture network remains internal. The API container has a loopback-only relay to
the owned gateway so the maintained provider can fetch its canonical local JWKS
URL from inside Docker. This relay carries no new authorization or public ingress.
It does not change application issuer, audience, TLS checks or production policy.

The maintained provider requires non-loopback HTTPS callbacks for web clients.
The local protocol-driver callback is the reserved `https://client.example.test/callback`:
the smoke captures its returned code without navigating or contacting that host.
There is no TLS callback listener. This client/redirect is **not** a ChatGPT client
registration and must not be reused as a generic real-client fallback.

The lab retains its owned containers and volumes for follow-up testing. State,
random infrastructure credentials and receipts live under ignored `.qa/hosted/`.
Do not paste `state.json`, `compose.env`, cookies or tokens into issues or logs.
To inspect or stop only this checkout's owned project:

```powershell
mise exec -- node scripts/hosted-qa/run.mjs status
mise exec -- node scripts/hosted-qa/run.mjs down
```

`down` preserves data; `reset` is a separate explicit disposable-data operation.
Ordinary `up` switches back to the standard fixture mode with MCP off. Real-provider
mode is refused while this synthetic MCP mode is selected.

### Secure MCP Tunnel and the HTTP loopback lab

Use a restricted runtime key with Tunnels Read + Use in the same personal Platform
organization as the target ChatGPT account, and associate the tunnel with that
ChatGPT workspace. The runtime key is separate from Domi Ops OAuth credentials;
enter it locally through a hidden prompt and pass it to the client by environment
reference. Never put it in a plugin bundle, command argument or receipt.

With official `tunnel-client` v0.0.17, the HTTP lab also needs
`--harpoon.allow-plaintext-http`. This permits its discovery-derived HTTP callouts
to the lab's loopback origin. Without it, the daemon can report ready and poll
successfully while ChatGPT OAuth discovery fails: automatic target registration
rejects the HTTP origin, then queued discovery calls fail with `unsupported channel
"harpoon"`. Apply this option only to the isolated synthetic localhost lab. Normal
hosted and self-hosted production endpoints require HTTPS.

Observed transport evidence: `/healthz` and `/readyz` returned 200, control-plane
polling succeeded with zero consecutive failures, and local OAuth metadata was
discovered. The first actual ChatGPT discovery attempt failed with the Harpoon
condition above. After enabling the local HTTP option, actual ChatGPT discovery
succeeded and a private synthetic plugin was created. Its advanced OAuth settings
use the canonical Domi Ops resource and authorization-server identifier, while
retaining the tunnel's discovered token endpoint for server-side exchange.
Actual OAuth consent and tool reads subsequently passed. Transport readiness
alone would not establish those results or packaged briefing behavior.

The first browser authorization request reached Domi Ops with the correct scopes,
PKCE challenge and resource, but the auth proxy built its consent redirect from
Next's internal `0.0.0.0:3000` request origin. Validated redirects now use a relative
Location so the browser retains its public origin behind either hosted or
self-hosted proxies. Signed query bytes and separate cookies remain intact;
foreign origins and network-path targets are rejected. The updated QA web image
completed the actual browser flow and retained the canonical public consent URL.

## Prepare the private plugin

After smoke succeeds, `.qa/hosted/mcp-public-client.json` contains only the lab
origin and public client ID. For a **local-only package rehearsal**:

```powershell
$client = Get-Content .qa/hosted/mcp-public-client.json | ConvertFrom-Json
mise exec -- node scripts/mcp-chatgpt/package.mjs $client.origin $client.clientId .qa/chatgpt-local-plugin
```

The output directory must be new. The generator copies the shared briefing skill
and MIT license byte-for-byte, sets the deployment's canonical resource, and emits
no secrets, tokens, client registration calls or paid entitlement. It supports
public `none` or pre-registered confidential basic/post authentication; secret
entry remains outside the bundle. Archive that output folder only when the target
surface requires a ZIP.

Before installing a live ChatGPT test connection, choose its approved transport,
register its exact callback as a distinct synthetic `provider: chatgpt` profile
through the existing trusted operator registration API, and generate a new package
with that client ID and reachable canonical origin. Do not import the local-only
rehearsal package as proof of a working ChatGPT connection. Do not copy production
Google tokens or broaden scopes to make a failing setup appear to work.

`scripts/mcp-chatgpt/register-client.mjs <exact-ChatGPT-callback>` is an operator
entry point for the owned synthetic QA tools container only. It refuses ordinary
deployments, registers a PKCE public client with the existing trusted API, and
stores only its public client metadata under `/qa/chatgpt-client.json`. It creates
no member grant, enables no DCR/CIMD and preserves a prior matching registration.

To bundle the skill with an **already registered** ChatGPT MCP connection (including
a tunnel connection), use its technical `plugin_asdk_app_...` ID:

```powershell
mise exec -- node scripts/mcp-chatgpt/package.mjs --registered <technical-plugin-id> .qa/chatgpt-registered-plugin
```

This emits root `plugin.json`, `.app.json` and the unchanged shared skill/license.
The generator accepts the browser's `plugin_asdk_app_...` ID or the underlying
`asdk_app_...` server ID, and emits only the latter in `.app.json`, as required by
the registered-server schema. The OpenAI extension references that connection. It includes
no second endpoint, client registration or credentials. Keep account-specific
packages private. Upload/install and actual invocation are separate acceptance
steps; copying the skill into a ZIP does not establish model compliance.

### Observed ChatGPT web installation path

On the tested personal Plus account, the initial Plugins archive imports returned
only “Couldn't add plugin. Try again.” The combined packages incorrectly used the
browser's `plugin_asdk_app_...` ID in `.app.json`; its schema requires `asdk_app_...`.
After correcting that ID, the portable archive imported and installed successfully.
The payload differed only in `.app.json`; the private cloud plugin displayed one
connected synthetic app and one bundled briefing skill. A prior skill-only
compatibility archive also failed generically; its separate cause was not established.

The combined plugin now installs through Plugins → Add → Upload plugin archive,
followed by Install plugin. This private registered-server package is not a public
submission artifact. No production identity or submission was needed for this test.

Skills → Add skill → Upload from your computer successfully imported a ZIP
containing `domi-ops-household-briefing/SKILL.md` and its MIT license. The skill
appeared under Installed, with its workflow visible in the skill inspector.
Use this standalone path with the separately configured synthetic MCP connection.
Try in chat selected the installed skill in Work mode; select only the Domi Ops
synthetic plugin for the evaluation. This supplies no additional permissions.

Create that standalone archive from the unchanged source folder:

```powershell
Compress-Archive -LiteralPath skills/domi-ops-household-briefing -DestinationPath .qa/domi-ops-household-briefing-standalone.zip
```

Use a new output path; do not overwrite an earlier evaluation receipt. Import the
ZIP through **Skills**, not Plugins. No endpoint or OAuth credentials are included.

The first invocation correctly requested reconnect while the grant was revoked.
Fresh consent retained the same read scopes and explicitly selected one fictional
note. Execution then paused at the account's Work usage limit; quota is independent
of MCP authorization. Resume only after the account offers Continue chat. Do not
purchase credits or upgrade as part of this test.

## Acceptance receipts

The local smoke records redacted stage names in `.qa/hosted/mcp-smoke.json` after:
discovery/challenge; real browser-session login and PKCE consent with one selected
note; all five tools through the actual web/API gateway; refresh rotation; and
disconnect rejection. It uses a synthetic protocol driver, not ChatGPT or a model.
Its receipts explicitly keep `liveChatGPTVerified:false`.

Capture these actual client receipts separately from the local smoke:

| Check | Evidence to capture without credentials |
| --- | --- |
| Account/surface | Plan and personal/workspace policy, browser/app version, direct MCP versus packaged skill support |
| Connect and consent | Exact callback, profile/policy versions, chosen member/household, requested/granted scopes and note selection |
| Reads and briefing | Tool metadata and real traces for each approved read, linked sources, empty/partial cases and hostile reference data; skill version/hash separately |
| Expiry/reauthorization | Real access expiry, reconnect/refresh behavior and preserved member/selection boundaries |
| Disconnect | Both product-side disconnect and subsequent denied calls; provider removal is separate |
| Negative scope | Foreign/unselected notes and excluded domains inaccessible; no browser cookies or Google credentials in MCP requests |

Keep raw sensitive traces private; publish only bounded redacted outcomes. No
marketplace submission, public distribution or real-household pilot is authorized
by this local setup. Keep deployed installations disabled until applicable rollout
gates pass.

## Local verification receipt (2026-10-22)

- Owned project `domi-ops-qa-351f1fe8f1`, loopback17180–17186. Production web/API
  image build passed. The API's nonproduction loopback exception and restricted
  application role were used; no external transport or permissive TLS override.
- Real deployed local web/API smoke passed all five stages above, including two
  repeated runs with synthetic grants revoked afterward. Receipts include branch,
  base commit and modified-worktree state; no bearer/refresh values are stored.
- Full disposable PostgreSQL/HTTPS authorization matrix: **127 passed**, five
  files,101.92seconds, including the existing official modern SDK roundtrip.
- Regular suite: **1,510 passed,934 environment-dependent skipped**. Four added
  real-network Next bridge regressions check canonical Host across different
  upstream addresses, protocol headers/cookie removal, bearer challenge/no redirect
  following, byte limits and an empty upstream response.
- Repository typecheck: **17/17 tasks passed**. Package/QA ownership/cleanup node
  tests: **12 passed**. The generated local-only package contains four files:
  `plugin.json`, `mcp.json`, the shared `SKILL.md` and MIT license.

These local checks establish protocol behavior. The actual-client checks below
are separate; these changes are not a production deployment.

## Actual ChatGPT receipt (2026-10-22)

- Personal Plus account, ChatGPT web in Chrome, private development connection,
  Secure MCP Tunnel v0.0.17. Actual OAuth used a distinct approved synthetic public
  client, exact UI callback, PKCE S256, canonical resource and explicit member consent.
- Database audit metadata confirms context first, shopping, chores, selected-note
  listing and one selected note body all succeeded. The rendered answer matched
  the fictional household, shopping, chore and note text. No writes were available.
- The ChatGPT response panel temporarily failed even in a no-app control chat,
  then recovered. Visible answer verification passed after recovery. User reported
  ordinary replies were working independently; the transient error is not a
  current MCP blocker.
- Repeated fresh reads succeeded, with refresh-token rotation observed through
  metadata only. Controlled expiry of **only the synthetic refresh credential**
  produced ChatGPT's Reconnect prompt. No successful reads occurred after expiry
  until fresh consent. This does not prove natural access-token or 30-day grant expiry.
- Reconsent revoked the prior grant and activated a new grant with **zero selected
  notes**. A subsequent fresh selected-note list returned zero; the old selected
  note body was not reread. Note selection was not silently carried forward.
- Disconnecting that grant through Domi Ops AI Connections showed the product's
  disconnected state. The next actual ChatGPT context request produced Reconnect,
  with zero successful audit events after revocation. A later explicit reconnect
  selected one fictional note for the installed-skill test.
- Direct-tool output included source links, but rendered URLs had ChatGPT-added
  `utm_source` parameters. Exact byte-for-byte link preservation and installed-skill
  behavior are not established by the direct-tool summary alone.
- Focused auth-proxy and real-network bridge suite: **13 passed**; web typecheck
  and updated QA web Docker build passed. Package tests: **4 passed**, including
  byte-identical skill packaging through the registered-connection path.

### Installed-skill result

- Dedicated Skills import succeeded and Try in chat selected the installed
  `domi-ops-household-briefing` skill with the existing synthetic MCP connection.
  The Work usage reset allowed the paused invocation to continue. The model
  selector displayed GPT-6.1 Sol Light; this is one observed account/surface run.
- Audit metadata records exactly five successful reads in order: context, chores,
  shopping, selected notes, one note body. Each list used one page and the note one
  chunk, within the skill's 12-call budget. No writes are exposed by the server.
- The visible answer used the correct household, October 22 date and America/Chicago
  timezone, grouped the chore as due today, included the two-bag shopping quantity
  and fictional note text, disclosed persisted-only/complete coverage and unchecked
  Calendar/School/Health, and stated no changes were saved.
- All three actual rendered `href` values exactly matched the supplied app links
  in this Work response; unlike the earlier direct-tool Chat response, no tracking
  parameters were added. This does not guarantee identical rendering elsewhere.
- Uploaded version0.1.0 source SHA256 (Windows CRLF bytes):
  `7b441ae0a214193b0054240836a6f1bb4cf2d7cdb176760b0ada3e478650f2bd`.
  Normalized LF/repository SHA256:
  `a041a42251a71be9e61d4317172b60547a823655f96ef0790a5a59aa0321d065`.
  Archive SKILL/license bytes matched the source; the importer added its own
  presentation metadata. No shared workflow edits were needed.
- A transient response-panel error recurred during execution; reloading recovered
  the complete final answer. Backend reads succeeded independently of rendering.

### Combined-plugin briefing result

Launching Try in chat from the installed combined plugin selected that plugin in
a new Work conversation. The request explicitly invoked its bundled briefing
skill and used only its existing synthetic connection. Audit metadata confirms
five fresh successful reads, in order: context, chores, shopping, selected-note
list, and one note body. The final visible answer matched all fictional records,
used the correct household-local date/timezone and due-today grouping, preserved
all three source hrefs exactly, disclosed complete persisted-only coverage and
excluded domains, and stated no changes were saved. This run completed without
a reconnect, quota pause or response-panel reload.

Private synthetic acceptance is ready for code review through both the standalone
and combined-plugin installation paths. Repository typecheck passed17/17 tasks;
focused proxy regressions13passed and package/QA safety tests12passed.
Desktop/mobile eligibility,
real-household pilot, live hostile/pagination scenarios and natural expiry intervals
were not measured by this run; existing automated security/contract evidence is
separate. No public listing, deployment or real-household pilot has occurred.
