# MCP M1 decisions and implementation handoff

Status: M1 design resolved, 2026-10-21. This document supersedes the preliminary
[M1 plan](MCP_M1_PLAN.md). No production feature is enabled.
Baseline: origin/main `02cee513b42757f23a7feb3807769b3505b00ec4` (v0.11.3).
Linear: WHO-467, WHO-468, WHO-485, WHO-486.

## Accepted product boundary

The owner explicitly approved inclusion in the base hosted price and free
self-hosted availability. Standard MCP tools and reusable skills require no
add-on SKU, paid integration entitlement or per-member connection charge.
The customer supplies their assistant account; Domi Ops does not provide model
inference/credits or autonomous background execution. Existing prices are unchanged.

MCP is an integration point. Deployment enablement, household opt-in and individual
consent gate access independently of modules. Each tool still checks its source
module, live member/record permissions and logical subscription rules. Shared
hosted accounts in read-only mode retain approved reads; consent management and
revocation remain security/account controls. Future writes require the existing
`subscriptionAllowsWork` policy at tool execution.

There is no required Cloud account, license callback, Cloud auth broker or paid
identity provider for self-host. No new paid vendor or inference spend is needed
for v1. Use the existing stack, bounded request limits and an allowlisted pilot.
Track incremental infrastructure and support costs before broad rollout.
A managed-inference product would be a separate future decision.

The owner reports the Google OAuth video is submitted. Submission is not approval,
and does not approve sharing Google-derived data with an assistant.

## Dependency and protocol selection

| Component | Exact baseline | Evidence |
| --- | --- | --- |
| Node / TypeScript | 22.23.2 / 5.8.3 | Runtime and application-facing typecheck |
| Better Auth + provider + core | 1.7.10 | Existing login baseline, synthetic OAuth/Drizzle lifecycle |
| better-call | 1.4.2 | Matching auth peer; no forced dependency resolution |
| MCP server / client | 2.3.1 | Official v2 authenticated tool round trip |
| MCP Hono adapter | 2.0.2 | Runs with existing Hono 4.13.13 |
| Hono Node server / Drizzle / Zod | 2.1.5 / 0.45.4 / 4.6.7 | Existing compatible versions used by fixture |

Use `oauthProvider` from `@better-auth/oauth-provider` with the existing
`username()` and the maintained `jwt()` plugin. Do not install another overlapping
MCP OAuth provider. Pin the auth family; an unpinned core peer selected 1.7.12 and
failed the provider's exact better-call peer. No login upgrade is required for
this design.

Disable the JWT plugin's generic browser-session `/token` path. Only the scoped
OAuth token endpoint issues delegated MCP credentials; do not add a second token
API to the existing login surface.

Use the official MCP v2 server/Hono integration with the 2026-07-28 protocol,
stateless JSON responses and no persistent MCP transport sessions. Legacy protocol
support is not implemented speculatively. WHO-475–WHO-477 must test actual client
versions; if one needs a legacy path, add SDK-supported compatibility in a focused
change before claiming support. No custom protocol parser, sampling, resources,
subscriptions or agent jobs are in v1.

WHO-477 compatibility update: actual Gemini completed OAuth token exchange but
received an authenticated protocol rejection from the modern-only gateway. The
SDK's stateless 2025 mode now serves both formats from the same authorized factory,
with finite legacy SSE framing where the SDK requires it. Restricted-role tests
cover 2025 initialization, reads, scope refusal and revocation in single/shared
deployments. Actual Gemini 2025-11-25 discovery, five reads, refresh rotation and
installed briefing now pass; scope refusal and grant/credential revocation are
verified with the evidence limits in MCP_GEMINI.md. Discovery also advertises
the existing `offline_access` scope so clients can request refresh support. It is
never added to an existing grant or token without explicit request/consent. This
does not enable production Gemini.

Future production dependency commands, not executed on app workspaces in M1:

```sh
npm install -w @domi-ops/auth --save-exact better-auth@1.7.10 @better-auth/core@1.7.10 better-call@1.4.2 @better-auth/oauth-provider@1.7.10
npm install -w @domi-ops/api --save-exact @modelcontextprotocol/server@2.3.1 @modelcontextprotocol/hono@2.0.2 zod@4.6.7
```

Keep existing Hono/Drizzle versions and use the client SDK as test tooling.
Review lockfile changes for unintended auth-family drift. The isolated package
has its own lockfile; root package.json/package-lock.json were not changed.
The adapter sets `parsedBody` but omits its published context-variable type:
declare it in the MCP context typing, as demonstrated by the type probe.

## Routing and deployment

One Hono implementation in both single/self-host and shared/hosted modes:

`HTTPS edge -> MCP-only bearer branch -> verified issuer/audience/scope -> live connection/member -> short tenant transaction -> pure read service -> bounded result`

| Route | Responsibility |
| --- | --- |
| `/api/mcp` | Stateless authenticated MCP tool/discovery endpoint |
| `/.well-known/oauth-protected-resource/api/mcp` | Canonical metadata for the exact resource URL |
| `/.well-known/oauth-protected-resource` | Same resource metadata for clients using root discovery |
| `/.well-known/oauth-authorization-server/auth` | Route to provider AS metadata helper |
| `/auth/.well-known/oauth-authorization-server` | Provider's issuer-relative metadata route |
| `/auth/oauth2/*` and `/auth/jwks` | Maintained provider endpoints and public signing keys |
| `/settings/ai-connections`, `/ai/consent` | Normal browser-session connection controls/consent |

Issuer is canonical `PUBLIC_APP_URL + /auth`; resource/audience is canonical
`PUBLIC_APP_URL + /api/mcp`, with trailing-slash handling fixed centrally.
Do not derive either from client Host/forwarded headers. OAuth challenges identify
the path-specific resource metadata URL. Bearer failure returns 401 with metadata;
scope failures are distinct from authentication failures. Unselected/foreign note
lookups return a uniform unavailable result.

The dedicated MCP branch must run before cookie-only middleware and generic
HTTP-method subscription middleware. A cookie cannot rescue an invalid/missing
MCP bearer. Bind identity anew per request, then use existing tenant transaction
helpers. Never hold a tenant transaction across client interaction/transport
lifetime. Register no domain after-commit callback for a read.

Planned Caddy routing explicitly sends exact MCP, discovery and auth-provider
paths to Hono; ordinary web routes retain their current proxy path. Make well-known
paths public to discovery without exposing protected data. Validate canonical
HTTPS, proxy header handling, Host and Origin checks, request limits and discovery
under actual deployments in M2. Do not weaken global browser CORS or cookie rules.

Self-host uses the operator's canonical origin and local issuer/keys. Cloud uses
its origin and restricted tenant-scoped database role. Provider-cloud connectors
require reachable HTTPS; there is no automatic LAN exposure, tunnel publication
or required relay. Private/local network access is a separately documented client
capability, not a promise of cross-client support.

## Authorization and immutable grants

V1 uses operator/owner-approved pre-registered clients. Disable anonymous DCR,
CIMD fetch, arbitrary callback registration and machine grants. Do not identify a
client as trusted from its self-declared name. Register exact verified callback
URIs per deployment/client; public clients use PKCE with `none`, confidential
clients use the supported registered secret method plus PKCE. The fixture
verified both public and confidential authorization-code flows.
Client CRUD/resource administration is operator-controlled, not a capability
available to an arbitrary logged-in household member.

Use authorization-code S256 + refresh tokens only. Access token TTL is 5 minutes,
authorization code TTL 10 minutes, refresh TTL 30 days with rotation and no replay
grace. Include `offline_access` in the provider resource's scope allowlist when
requested: the fixture proved that omitting it stops refresh-token continuation.
It grants token lifecycle only, never reads, writes or unattended jobs.

Persist an immutable application connection ID as the provider consent reference
using supported `postLogin.consentReferenceId`; emit it as `domi_grant_id` through
`customAccessTokenClaims`. The fixture proved the reference survives refresh.
In production, resolve the reference from a server-owned pending consent bound to
the user, session, exact signed authorization query, client, resource and chosen
records. Request-local context must not be a session-global "last selected grant".
Provider query signatures and one-use/expiry checks must pass before activation.
M2 tests must cover two concurrent tabs, rejected consent and refresh after revoke.

Only pending connections may activate. An active connection's scopes/selected
records may be narrowed; any expansion requires fresh consent and a new immutable
grant ID. A revoked grant is never reactivated. Reconnect creates a new grant, so
an old JWT cannot regain access after reconnect. Remove a selected note immediately
without widening another connection.

Every call verifies signature, exact issuer/audience, expiry, client and required
scope, then resolves `domi_grant_id` and compares its stored user/client/resource,
active state, current membership and effective permissions. No positive grant
cache across requests. The fixture shows a valid JWT can still pass cryptographic
verification after refresh revocation; live grant checking is mandatory.
Refresh and token issuance also reject inactive grants through the claim/binding
hook. Disconnect commits local revocation first, then revokes provider artifacts;
local denial must hold even if provider cleanup fails.

Use JWT plugin key encryption, hashed OAuth client secrets and hashed refresh/
opaque tokens. Public JWKS must never include private material. Keep at least the
previous verification key available for the maximum live access-token lifetime
during controlled rotation. Existing Google/session credentials never become MCP
credentials.

## Schema and tenant policy contract

Use additive, journaled Drizzle migrations. Keep provider column names/types and
references from the installed schema; do not create a hand-written OAuth engine.
The checked-in redacted receipts contain the exact provider model fields used in
the synthetic Drizzle probe.

| Table group | Ownership and required policy |
| --- | --- |
| `mcp_oauth_clients`, `mcp_oauth_resources`, `mcp_oauth_client_resources`, `mcp_oauth_client_assertions`, signing JWKS | Deployment-global authorization metadata/credentials; no public CRUD; explicit privileged provider repository |
| `mcp_oauth_consents`, `mcp_oauth_access_tokens`, `mcp_oauth_refresh_tokens` | Provider-managed user/client/reference-bound auth artifacts; access only through provider handlers and narrow account controls |
| `mcp_household_settings` | household_id PK, enabled, updated_by_member_id, updated_at; owner/admin enablement, household RLS |
| `mcp_connections` | UUID PK; household/member/user, issuer/resource/client ID, status, granted scopes, consent/policy/client-profile versions, attested adult/privacy settings, timestamps/expiry/revocation |
| `mcp_note_selections` | connection_id + note_id PK, household_id, selected_at; composite relationships enforce same household; reads still recheck note ACL |
| `mcp_pending_consents` | UUID/nonce, user/session/client/resource, signed-query hash, requested scopes/selection, expiry/consumed_at; identity lookup only, never public listing |
| `mcp_access_events` | household/connection/actor/tool/outcome, request ID, duration, byte count, timestamp; no content/token/query text |

Use UUID application IDs and custom existing `users`/`ba_*` model mappings;
the PostgreSQL probe validated that adapter composition. Provider model aliases
map to the new SQL names above via its supported schema options. Keep auth artifact
ownership distinct from domain household rows: global auth metadata must not be
given a broad household-admin API or worker-scan policy.

Resolve identity/grants by cryptographically verified user/reference with a
narrow identity lookup context, then enter household context. New household tables
use fail-closed RLS under the hosted app role and explicit household predicates in
all modes. Add composite indexes/FKs required to prevent cross-household selection.
No `system_access`/worker-scan bypass for MCP tools. Define the provider repository's
role/grants explicitly during migration rather than relying on a superuser app
connection. Provider-global metadata tables are not a blanket authorization bypass
for application grants or note selections.

Retain security/access-event metadata for 30 days, prune without raw payloads,
and delete selections/pending states with their connection/account as appropriate.
Revoked grant tombstones remain until their longest-issued token expires; revoke
and purge must not permit token resurrection. Pending consent lasts at most
10 minutes. Exclude audit detail from unrelated household members; the connection
owner sees their metadata and operators use existing authorized support access.
No analytics opt-in is inferred from connecting an assistant.

## Tools and data handling

Keep the five bounded tools and result field allowlists from the preliminary plan:
context, shopping, chores, selected-note list and selected-note text. Scopes are
`shopping:read`, `chores:read`, optional `notes:read`; there is no broad all-data
scope. Default note selection is empty. Initial limits are 25/default, 50/max rows,
6,000 characters/note chunk, 32 KiB/result, 10s deadline, 2 concurrent executions/
connection and 30/120 requests/minute per connection/household. These are initial
enforced engineering ceilings, not measured capacity or an unlimited service offer.

Queries read persisted records only. No recurring materialization/roll-forward,
notifications, reminder writes, jobs or domain after-commit callbacks. State the
persisted-only coverage honestly. Exclude item costs/free-text notes/receipts,
chore descriptions, arbitrary files, attachments/embeds, Google-derived records,
Calendar, School, Health and household administration. Selected-note text is
untrusted and may contain sensitive/copied material: do not claim automatic
classification or follow embedded links/instructions.

Read-only refers to household/domain data. Bounded security audit events and
rate-limit counters are permitted operational writes; isolation tests must allow
those expected metadata writes while denying domain mutations and notification/job
side effects. They must never store returned content or raw request arguments.

Initial adults-only pilot requires explicit 18+ attestation and excludes child/
guest roles. Owner/admin enablement does not make another member's private content
readable. Explain household data sharing to participating adults before opt-in.
Use synthetic notes first and carefully reviewed minimal data for real dogfood.

### Provider/client policy decision

WHO-478 update, owner approved 2026-10-23: retain privacy-focused defaults and
plain provider-specific risk disclosure, while allowing an informed adult to opt
in to a supported provider. This supersedes the initial consumer Gemini ban;
technical support and data-handling preferences are separate decisions. No live
household connection or deployment is authorized by this policy update alone.

| Surface | M1 disposition | Conditions before real data |
| --- | --- | --- |
| ChatGPT | Eligible for limited adult pilot after M4 client acceptance | Review exact account controls/terms; record privacy-setting attestation and disclosure. Do not assume API retention or zero-training terms apply to consumer chat |
| Claude consumer | Eligible for limited adult pilot after M4 client acceptance | Explain data handling and settings; recommend Model Improvement off/appropriate Incognito use and avoiding content-bearing feedback; require informed consent |
| Gemini consumer custom app | Eligible for explicitly consented native-data pilot under WHO-478 | Explain required Keep Activity, possible training/human review and reviewed-chat retention; versioned unchecked risk acknowledgment before any grant; remain disabled without operator/household/member opt-in |
| Business/API/local assistant surfaces | Not automatically equivalent to the consumer product | Approve exact operator-reviewed client profile, retention/settings and credential flow before real data |

Claude's published policy excludes raw connector payloads from training but permits
conversation copies under applicable settings; deletion/retention has exceptions.
Gemini's published custom-app prerequisites require Keep Activity, and its privacy
notice describes training/human review with that setting. Those facts remain in
the consent disclosure; they do not automatically exclude Gemini after the
owner's WHO-478 decision. Recommend minimal scopes and no notes initially.

Client eligibility is an operator-managed profile attached to a registered client
and consent version, not a name supplied by the model. Synthetic evaluations use
separate fictional-only deployments. Real profiles remain disabled by default and
require reviewed provisioning, household enablement and affirmative member consent.
Domi Ops cannot observe or enforce a remote user's privacy
toggle. Record attestation accurately, require reconfirmation when policy changes,
and never advertise a guarantee of provider non-retention/no-training.

Consent policy `2026-10-23.v2` records acceptance of provider data-use risks and
the disconnect limitation. Old-policy grants fail live checks and need fresh
consent after upgrade; no token or grant is silently widened or reactivated.
The ordinary login session and Google grant are unchanged. No schema migration is
needed. The Gemini protocol receipts remain synthetic; real dogfood is pending.

Before consent, show exact client/member/household, data fields and optional
note selection; explain that sharing transfers content to the selected provider.
No auto-consent, bundled unrelated disclosure or checkbox preselection. Disconnect
stops future access and cannot erase assistant-side copies. Policy version changes
that expand sharing require re-consent. Privacy/help copy must explain these
integration-specific transfers before enabling real household access in M4.
Google/Health expansions remain WHO-482/WHO-483; no Google scope expansion or
privacy-policy rewrite is bundled into M1.

## Evidence and implementation order

The isolated [compatibility harness](../scripts/mcp-m1-compatibility/README.md)
has its own dependency lock and synthetic database. It exercises real provider/
SDK code, not a mock of those libraries:
- Memory-adapter lifecycle + HTTP MCP checks, including public-client PKCE.
- Same lifecycle through PostgreSQL Drizzle with UUIDs and custom auth model names.
- Negative JWT issuer/audience/scope/expiry checks, refresh rotation/revocation and
  immutable reference claim across refresh.
- Separate restricted-role two-household grant-table RLS/context-leak fixture.
- TypeScript 5.8.3 application-facing composition check.

This does not prove production migrations, app-domain isolation, concurrent
consent binding, live reverse-proxy/TLS behavior or vendor account acceptance.
Those are explicit implementation/release gates, not unresolved M1 choices.

Implementation order:
1. WHO-469: additive schema/provider repository, consent reference binding, PKCE/
   refresh/live-grant checks and narrow lookup/RLS rules.
2. WHO-470: household enablement, individual consent/attestation, selection/revoke UI.
3. WHO-471: guarded Hono branch, metadata/edge routing, rate limits/audit and logical
   subscription checks.
4. WHO-472/473: pure queries and full application isolation/no-side-effect matrix in
   single and two-household restricted-role shared modes.
5. WHO-474–478: skill, actual client/profile acceptance, opt-in self-host dogfood,
   separate hosted pilot and authorized release decision.

M1 is complete as design/compatibility work. WHO-469's local authorization
implementation is described in [MCP_AUTHORIZATION.md](MCP_AUTHORIZATION.md).
No production client, grant, deployment, billing configuration or Google token was
changed during M1. The design/compatibility phase performed no commit, push or
public plugin submission; subsequent implementation and PR work is tracked separately.

## Sources checked 2026-10-21

- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Official SDK/Hono](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/hono/)
- [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)
- [OpenAI MCP authorization](https://developers.openai.com/plugins/build/auth)
- [OpenAI plugin privacy principles](https://developers.openai.com/plugins/guides/security-privacy)
- [ChatGPT Work data-control boundary](https://learn.chatgpt.com/docs/browser#privacy-and-browser-data)
- [Claude training](https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training)
- [Claude retention](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data)
- [Gemini custom-app prerequisites](https://support.google.com/gemini/answer/17209137)
- [Gemini privacy](https://support.google.com/gemini/answer/13594961?hl=en)
- [Google Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy?hl=en)

Provider terms and client availability can change. M4 rechecks exact surfaces
before real data. Source inspection, fixture evidence and live acceptance are
separate evidence classes.
