# Grok Bot read-only integration (WHO-489)

Status: local, default-disabled implementation and draft packaging. Grok Bot
desktop OAuth, a fictional-data briefing, refresh rotation and Domi Ops disconnect
were exercised on 2026-10-28. Combined marketplace activation and the remaining
client cases below are unverified. No provider submission, production deployment
or real household grant is implied. This
specific client work is sequenced before WHO-480; WHO-479 stays separate.

## Identity and release boundary

The published metadata at `https://cursor.com/oauth/mcp-client.json` returned a
direct HTTPS 200 JSON response when checked on 2026-10-28. It identifies a public
client (`token_endpoint_auth_method=none`) with authorization-code/refresh grants.
It lists Cursor cloud, Bot, ordinary Grok and two loopback callbacks. This
integration pins that complete metadata redirect set and only allows the reviewed
cloud callback `https://www.cursor.com/agents/mcp/oauth/callback` in consent.
Other listed product callbacks do not receive a grant. Metadata drift fails closed.

This is a **shared Cursor cloud identity**, not cryptographic proof of an exclusive
Grok Bot client. The consent label says Grok Bot / Cursor cloud. Do not claim
isolation between products that use the same client ID and callback. Ordinary
Grok chat, Grok Build/CLI, Cursor desktop and xAI's model API are separate
acceptance targets and are not certified by these changes.

Client discovery is opt-in and establishes a local approved profile, never a
household enablement or member grant. DCR remains disabled; customer-supplied
client IDs, secrets, static bearer headers and generic provider-name registration
are not the supported path. Existing Claude/ChatGPT identity restrictions remain.
No new package dependency, migration, add-on or inference service is required.

## Hosted and self-hosted configuration

After reviewed release and explicit target deployment authorization:

```dotenv
MCP_ENABLED=true
MCP_GROK_BOT_ENABLED=true
MCP_READ_SCOPES=shopping:read,chores:read
```

The new flag defaults off. Enabling it requires a non-demo deployment and an
**explicit deployment-wide shopping/chores-only read ceiling**. Discovery retains
`offline_access`, so the client can request refresh during its first consent.
This avoids advertising notes that the Grok Bot profile does not permit. Do not
silently alter an existing server's ceiling: narrowing this setting also affects
other assistants and existing note grants. Review that impact before rollout.
Either read scope may be enabled independently. The setup card obtains the exact
enabled scopes from the server and retains `offline_access`; do not request a
disabled domain when configuring the Bot.

Hosted uses the canonical hosted `/api/mcp` endpoint. Each self-host installation
uses its own reachable HTTPS origin, signing/encryption keys and permissions.
Do not point a general listing at a real household server, publish databases,
introduce a broker or bypass authentication. Public HTTPS is the initial supported
network path; private-network/CA alternatives need their own acceptance.

The standard integration stays included in hosted base pricing and free for
self-hosting; customers provide an eligible Grok Bot account.

## Permissions and privacy

The provider profile caps effective permissions at `shopping:read`, `chores:read`
and `offline_access`, independently of the broader known-scope catalog. It cannot
request planning notes or write scopes. Existing member, role, household, module,
subscription and per-record checks remain in force on each call and refresh.
Canceled hosted subscriptions retain entitled logical reads; there is no add-on gate.

Household administrators enable the feature; each eligible adult personally
reviews the account settings, data-sharing risks, intended member/household and
exact scopes. The two existing privacy/settings acknowledgments start unchecked
and are required server-side for this provider. A household grant does not limit
shared shopping/chores to that person's assigned records. Child assignee names
are masked by the existing read projection; free text is not generally scrubbed.

Grok Bot uses Cursor account/privacy settings and requires cloud storage. App
connections can be available to other Bots on that account, and shared Bots have
additional sharing implications. Domi Ops cannot verify training settings, erase
provider copies or make unrelated Bot browser sessions read-only. Do not give the
Bot an ordinary browser login to the household app for this connector test.

## Draft package

```powershell
mise exec -- node scripts/mcp-grok-bot/package.mjs https://app.domi-ops.com .qa/grok-bot/NEW-DRAFT
# For a server with only MCP_READ_SCOPES=shopping:read:
mise exec -- node scripts/mcp-grok-bot/package.mjs https://selfhost.example.test .qa/grok-bot/SHOPPING-DRAFT shopping:read
```

Self-hosters substitute their own canonical origin. Output creation is exclusive:
an existing directory is refused. The `.cursor-plugin/plugin.json` manifest,
`mcp.json`, icon, README and unchanged shared SKILL.md/MIT license contain one
remote connection, no secrets, local commands, hooks or routines. The public
`auth.CLIENT_ID` is the pinned metadata URL; `auth.scopes` explicitly requests
shopping, chores and refresh, rather than relying on a client registration guess.
The optional final CSV argument selects one or both read scopes and must match
the deployment's `MCP_READ_SCOPES`. Omission defaults to both; refresh is added
automatically. Notes, writes, duplicate scopes and empty selections are refused.
The format is documented by Cursor; actual catalog activation in Grok Bot still
needs verification.

The installed Bot's diagnostic response found no private ZIP import path. For
private acceptance, add the remote MCP URL with that public identity/read scopes
and save the shared SKILL.md as a private skill separately. Do not label a
standalone-skill check as a successful combined marketplace-plugin import.
The private skill editor normalizes frontmatter; the installed Bot reported
restoring the license/version fields and saving the MIT text as a supporting file.
That report is not a byte-for-byte export verification of the installed skill.

The official Grok Bot marketplace form accepts an MCP URL or a public repository
and requires local/in-app testing. It offers Grok Bot and Cursor separately;
ordinary Grok distribution is marked coming soon. Preparing a package is not
permission to upload, accept publisher terms or submit. Use the existing fictional
reviewer material after compatibility is proven; never include real household
records, credentials or private test receipts in the repository/package.

## Required acceptance

### Installed desktop evidence, 2026-10-28

- Windows Grok Bot executable version `0.78.1` in the owner's existing signed-in
  account; paid-plan eligibility was not independently verified. No mobile or
  other-account/plan acceptance is implied.
- A fresh, restricted-role, fictional-only local QA lab was reached over temporary
  public HTTPS. The actual authorization request used the pinned public client ID,
  exact cloud callback, S256 PKCE, canonical resource and exactly shopping, chores
  and refresh. The final local callback displayed **Authorization complete**.
- The app showed **Connected · 1 Account** and exactly three advertised reads.
  Using the saved private briefing skill, it returned the expected open chore and
  unchecked shopping item, source links, household timezone and retrieval time.
  Server audit recorded one successful context, chores and shopping call each.
- Server metadata recorded refresh-token rotation immediately after authorization.
  This verifies an actual client's refresh exchange, not long-duration expiry or
  unattended operation.
- The Bot refused notes and chore changes because those tools were absent. It did
  not send prohibited calls; server-side rejection is covered by the restricted-role
  regression suite rather than this installed-client refusal.
- Bot-initiated app removal required direct owner wording and did not execute.
  Disconnect was instead completed in Domi Ops' supported connection UI. The grant
  and both refresh rows were revoked; the next fresh Bot context call required
  authentication and returned no data. No reauthorization was completed.
- Private detailed receipts/screenshots remain under ignored `.qa/who-489/`.
  Production, WHome and real household records were not used.

### Remaining client checks

Combined marketplace activation, installed-skill export comparison, empty/partial
data and pagination, scope reduction/fresh consent, long-duration expiry and a
before/after domain/queue snapshot were not exercised in this desktop run. Do not
claim the full installed-client acceptance matrix or production readiness from
the successful minimal briefing. The disposable server regressions cover current
permissions/isolation, scope restrictions, refresh and revocation separately.

### Regression and follow-up checklist

- Run `pwsh -NoProfile -File scripts/test-mcp-auth.ps1` with a disposable restricted
  Postgres role. The Grok metadata fixture exercises real provider PKCE/consent,
  exact callback/scope policy, settings review, token/refresh, isolation, flag/profile
  disable, metadata drift and revocation in single/shared modes. These are server
  regressions, not an actual installed-client pass.
- Run `mise exec -- node --test scripts/mcp-grok-bot/package.test.mjs` plus the
  focused config/auth/web checks. Preserve the shared skill bytes.
- Before repeated linking, verify the installed Bot's actual client ID, callback,
  request scopes and metadata behavior using a fictional-only lab. Stop on the
  first unexpected request; resolve it against documented/profile behavior.
- On the installed client, verify briefings, source links, empty/partial results,
  note/write refusal, scope reduction, refresh, fresh consent and immediate
  disconnect. Snapshot domain/queue/notification state to exclude hidden effects.
  Distinguish fixture tests, hosted reviewer results and later real household use.
- Record the exact application version, account/plan and desktop/mobile surface.
  Do not infer mobile, other-plan or public-directory acceptance.

Disable `MCP_GROK_BOT_ENABLED` to block this published identity. Re-enabling must
not reactivate revoked grants or disabled profiles. User disconnect in Domi Ops
blocks future access; provider copies remain subject to its own terms/settings.

## Official sources checked 2026-10-28

- [Grok Bot connected apps](https://docs.x.ai/grok-bot/computer-and-apps)
- [Grok Bot skills](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [Grok Bot privacy/account boundaries](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- [Marketplace submission](https://x.ai/bot/marketplace/submit-a-plugin)
- [Published client metadata](https://cursor.com/oauth/mcp-client.json)
- [Cursor MCP/authentication](https://cursor.com/docs/mcp)
- [Portable plugin formats](https://cursor.com/docs/reference/plugins)

The live metadata response is primary evidence for the identity/redirect set;
Cursor editor documentation alone does not prove the installed Bot's behavior.
