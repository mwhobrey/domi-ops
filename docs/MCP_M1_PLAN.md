# MCP milestone 1: scope, architecture and packaging

Status: historical preliminary draft, superseded by [MCP_M1_DECISIONS.md](MCP_M1_DECISIONS.md).
The owner approved inclusion in base Cloud/free self-host. Remaining M1 choices
and compatibility evidence are resolved in that decision record; statements below
about pending owner decisions are retained as proposal history, not current gates.
Prepared: 2026-10-21.
Baseline: fetched `origin/main` at `02cee513b42757f23a7feb3807769b3505b00ec4` (v0.11.3).
Project: [AI assistant integrations — MCP & skills](https://linear.app/mikewhob-whome/project/ai-assistant-integrations-mcp-and-skills-85001fb48d70).

The owner reports the Google OAuth recording is complete and submitted. Google
approval is not confirmed. Recording preparation is no longer a prerequisite for
M1; exposing Google-derived content remains a separate M6 decision.

## 1. Outcome and commercial recommendation

M1 produces a reviewable implementation contract for M2. It does not enable MCP,
change billing, install dependencies, connect an assistant or alter live grants.

Recommend including standard MCP access and portable workflow skills in the base
Domi Ops Cloud subscription, with the same implementation available in MIT
self-hosted deployments. Customers bring their own compatible assistant accounts.
Domi Ops serves authorized tool requests; it does not run or pay for model
inference in this design. Assistant eligibility, subscriptions and limits remain
the customer's relationship with that provider.

| Option | Benefit | Cost / drawback | Recommendation |
| --- | --- | --- | --- |
| Included integration | Adds utility to the existing household subscription; simplest purchase and support story | Domi Ops still pays for API/DB/auth traffic, security maintenance and support | Proposed default |
| Paid MCP add-on | Can recover identifiable incremental cost | Another SKU, entitlement and cancellation path; customers may already pay an assistant provider | Defer without evidence |
| Managed AI or automation product | Could sell an outcome with inference/background work included | Different operating costs, retention and reliability obligations | Separate future decision |

This is a recommendation, not a locked price change. Current pricing docs and
marketing source say $12/month or $120/year; the owner recalled $12.99. Production
Stripe prices were not queried. Do not change or reconcile prices silently.

Current comparator pages list Homeschool Planet at $9.95/month or $84.95/year and
Syllabird at $6/$9 monthly or $60/$90 annually. These offers are not like-for-like
household products and do not establish willingness to pay for Domi Ops. They
support testing the value of the current bundle before adding another charge.

MCP is an integration capability, not another entry in `MODULES_ENABLED`.
Proposed eligibility is the intersection of deployment enablement, household
opt-in, current member permission, client grant/scopes, record selection and
the source module's availability/entitlement. Do not introduce a new paid feature
catalog or Stripe SKU for the initial release.

Self-host does not require a Cloud account, license callback, Stripe subscription
or mandatory paid identity service. Hosting ownership changes operations, not the
tool contract or record permissions.

## 2. One implementation, two deployment paths

Prefer a Streamable HTTP endpoint at `/api/mcp` inside the existing Hono API.
Extract pure query services shared by the MCP adapter and appropriate UI readers;
do not call authenticated browser endpoints with copied session cookies.

Request flow:

`client -> deployment HTTPS edge -> MCP bearer validation -> live member/grant checks -> short household-scoped transaction -> tool policy -> pure query -> bounded result`

| Concern | Self-host single mode | Cloud shared mode |
| --- | --- | --- |
| Endpoint | Operator's canonical app origin | Cloud app origin |
| Authorization issuer | Deployment-local issuer using local sign-in | Hosted issuer using hosted sign-in |
| Household | Explicit grant binding, even with one household | Explicit grant binding plus non-bypass tenant RLS |
| Authentication | Same scoped member/client grant; no admin shortcut | Same grant, sharing and current-role checks |
| Infrastructure | Operator's API, Postgres, Redis and TLS | Managed shared API, Postgres, Redis and TLS |
| Rollout | Owner enables instance; household/member opts in | Operator pilot allowlist, household/member opts in |
| Subscription | No hosted billing dependency | Source entitlements and logical operation rules |
| Inference | Customer's chosen assistant/provider | Customer's chosen assistant/provider |

Use the configured canonical app URL for issuer/resource identity and generated
links. Do not derive security identity from an untrusted Host header. Bind tokens
to the exact resource/deployment and household; reject tokens from another
installation even when user email addresses match.

Resolve bearer identity before opening tool tenant context. Existing browser
middleware must not overwrite it or let a browser cookie rescue an invalid MCP
bearer token. Browser consent continues to use the normal authenticated session.
The latest tenant middleware has after-commit callbacks: a pure read must not
register them or enqueue work.

One authorization server per deployment can be colocated with Hono. Prefer a
maintained implementation over custom OAuth. Better Auth's OAuth provider is a
candidate because the app already uses Better Auth; its compatibility with locked
1.7.10, adapters and tenant policy is not established by reading current docs.
WHO-486 must select exact stable versions and required migrations before M2.
Do not quietly upgrade the production login stack or install two overlapping
OAuth providers.

Use the official TypeScript SDK/Hono support. Pin supported protocol versions
after testing actual clients; the 2026-07-28 transport differs from older
Streamable HTTP. Avoid hand-built protocol/session compatibility. No long-lived
database transaction may span an MCP transport stream or client interaction.

Discovery and authorization metadata must resolve at the deployment origin
through the real proxy path. Plan explicit routes for well-known metadata;
existing Next rewrites alone do not demonstrate correct discovery. Check HTTPS,
canonical URLs, header forwarding, buffering, origin validation and allowed
redirects in both deployments.

Cloud remote connectors must reach the server from their provider's network.
A self-hosted app accessible only on a household LAN is not automatically usable
from consumer cloud assistants. The operator must choose a secure reachable
endpoint; M1 does not publish a tunnel. A local-client path may be evaluated later,
using the same scoped service and without a required Cloud relay.

## 3. Initial tool contract

All tool definitions and parameter names below are proposed implementation
contracts. Each call binds identity from its validated grant; callers cannot
supply household/member/client IDs to select a different identity.

| Tool | Inputs | Scope | Output allowlist |
| --- | --- | --- | --- |
| `get_connection_context` | none | authenticated grant | Connection/member display labels, household label/timezone, granted capabilities and enabled read tools |
| `list_shopping_items` | checked = open/all, cursor?, limit? | `shopping:read` | Persisted item ID, title, quantity/unit, checked state, aisle, app link |
| `list_chores` | status = open/completed/all, dueBefore? (local ISO date), cursor?, limit? | `chores:read` | Persisted chore ID/title, completion state, due value, assignee display label and app link |
| `list_selected_notes` | cursor?, limit? | `notes:read` | IDs/titles and app links for currently visible notes explicitly selected for this connection |
| `get_selected_note` | noteId, cursor? | `notes:read` | Selected note ID/title, bounded text chunk, app link and next cursor when required |

Namespaced scope spelling can change during provider selection, but scopes must
remain separate by capability. A context response reveals only the grant's
household/member, never the household roster, profile email or other connections.
No generic database search, arbitrary URL/file fetch, resource traversal, SQL or
server-side model call is available.

Common result envelope: schemaVersion, retrievedAt, householdTimezone,
coverage = persisted_records_only, data, nextCursor and explicit truncation flags.
Use deterministic opaque pagination bound to the connection/query. Return a
uniform unavailable response for a foreign, private, unselected or deleted note.
Grant revocation, removal from selection or loss of sharing takes effect on the
next call, including a paginated read.

Proposed initial engineering limits, to validate with fixtures before pilot:
25 items/page by default, maximum 50; at most 6,000 characters per note chunk;
32 KiB result budget; 10-second request deadline; two concurrent tool executions
per connection; 30 requests/minute per connection and 120/minute per household.
These are candidate safety limits, not measured capacity or marketing promises.
Report truncation and continuation honestly. Do not silently omit records to claim
a complete household summary.

Shopping costs, receipts, free-text item notes and tags are omitted initially.
Chore descriptions and arbitrary tags are also omitted. No file bodies,
Drive attachments/embeds, Google links/content, Calendar, School, Health,
expense records, grades or administrative changes are exposed.

Existing shopping GET and chore list/glance handlers create recurring records;
shopping GET can send notifications. Query persisted rows without calling those
handlers. Do not materialize, roll forward, complete chores, reset reminder state,
enqueue jobs or notify. The skill must say that unmaterialized future recurring
occurrences are outside its coverage. This avoids an inaccurate "everything due"
claim while preserving a genuinely read-only integration.

The first skill prepares a household briefing from permitted shopping/chores and
selected notes, cites records and explains missing coverage. It may suggest actions
in conversation but cannot save changes. Skills are guidance, not authorization.

## 4. Grants, consent and data handling

Design a grant bound to issuer/resource, client, user, member, household, scopes,
selected-note IDs and consent version, with expiry and revocation metadata.
Resolve current membership/role and record access for every call. Persist and
protect authorization codes, refresh tokens and signing material using the chosen
provider's supported mechanisms. Specify tenant/member ownership and RLS/lookup
rules for every new table; global auth tables do not inherit tenant protection
automatically.

Use PKCE authorization code flow, strict redirect matching and protected-resource
metadata. Prefer current client metadata registration where clients support it;
provide pre-registration or constrained dynamic registration only when verified
clients need it. Fetching client metadata/JWKS must guard against SSRF and
untrusted redirects. No shared owner credential, client-credentials grant or
background service-account access is part of v1.

Proposed consent sequence:
1. Authenticate to the deployment using existing sign-in.
2. Show the requesting client and destination, signed-in member and household.
3. Explain exactly which shopping/chore fields can leave the app.
4. Offer optional explicit note selection; default is none.
5. Disclose that selected note text may contain sensitive/copied third-party data,
   and sharing sends that text to the selected assistant provider.
6. Require affirmative approval for the requested capabilities.
7. Provide connection details, scope/selection review and revoke controls.

A household-level enable switch never grants a member another person's private
content. Per-record sharing and selection intersect. Owner/admin status does not
override private data permissions. Initial consent is restricted to the adult
pilot; use explicit pilot eligibility, not inference from a generic member role.

Free text cannot be reliably classified as "safe native data" from its table
alone. Do not auto-follow links, expand attachments or claim automatic PHI/Google
content detection. Pilot with reviewed synthetic notes before any deliberate
selection of real notes. Later provenance or sensitive-data expansion requires
the separate WHO-482/WHO-483 decisions.

WHO-468 must review the exact consumer/API surfaces and current provider terms,
data retention, training and human-access controls before real household content
is shared. Consent cannot make a prohibited transfer permissible. The existing
Google policy wording must not be broadened as a shortcut around that review.
Submission of the OAuth video does not authorize a new Google-data use case.

Revoke access server-side for the next request without revoking Google or browser
sessions. Explain that disconnecting cannot erase copies already held in an
assistant conversation. No raw prompts, note bodies or tool payloads in application
logs by default. Candidate operational audit retention is 30 days, subject to
WHO-468 review; record actor/client/tool/outcome, timing, byte count and request ID.
Do not assume an integration grant permits analytics.

## 5. Billing and enablement semantics

Proposed deployment flag: `MCP_ENABLED=false` by default. Hosted pilot allowlisting,
household opt-in and individual consent are additional gates, not purchased SKUs.
Settings may call it "AI connections"; it must not appear as a content module.

| Account condition | Permitted integration behavior |
| --- | --- |
| Self-host enabled with valid member grant | Approved read tools; hosted billing ignored |
| Hosted active/trial/grace with valid grant | Approved read tools; later writes separately authorized |
| Hosted read-only after subscription expiry | Preserve permission-limited reads; no materialization, writes or jobs |
| Module disabled or unavailable to household | Related tools/data unavailable |
| Membership revoked or grant invalid | No household tool access |
| Operator/household disables integration | Stop tool access; consent management/revoke remains available |

Connection consent/rotation/revocation are security/account controls, not domain
writes. Define their behavior in read-only hosted accounts explicitly. Do not
pass an MCP POST blindly through HTTP-method-based subscription enforcement.
Future writes use the existing subscriptionAllowsWork rules at tool execution.

Commercial guardrails: no inference credits, no "unlimited AI" promise and no
mandatory upgrade to connect a second household member. Pilot metrics include
request count/latency, query/connection load, response size, failures and support
time. Set an acceptable incremental infrastructure/support budget before broad
release; no reliable margin or add-on price can be calculated from current data.
Revisit paid packaging only with measured recurring cost or a distinct managed
service, plus an explicit owner decision.

## 6. Acceptance and dogfood sequence

M1 defines the following evidence plan; none of these runtime checks ran during
this documentation task.

| Check | Self-host single | Hosted shared |
| --- | --- | --- |
| Authenticated tool round trip and proxy discovery | Synthetic deployment at its own origin | Synthetic hosted origin |
| Two members, private/shared/selected notes | Own-only and explicit sharing boundaries | Same plus cross-household denial |
| Tenant enforcement | Explicit household predicates even if DB role bypasses RLS | Non-BYPASSRLS role, two households and fail-closed context |
| Token issuer/audience/expiry/revocation | Reject hosted/other-instance tokens | Reject self-host/other-household tokens |
| Pure reads | No domain writes, jobs, callbacks or notifications | Same including read-only subscriptions |
| Disable/module removal/concurrent calls | No stale access or identity mixing | Same across pooled connections |
| Rollback/recovery | Disable MCP without altering ordinary sessions | Same without disturbing other households |

Execution order after M1 is accepted:
1. M2/M3 use fixtures and isolated deployments; prove both columns with synthetic data.
2. Opt into the owner's self-hosted household using minimal scopes and reviewed data.
3. Record actual briefing utility, reconnect/revoke behavior and costs/support.
4. Run a separate hosted pilot after the two-household restricted-role matrix passes.
5. Recheck client support and applicable Google review status, then decide public rollout.

Self-host dogfood validates usability and the single-household path; it does not
establish hosted tenant isolation, willingness to pay or general capacity.
Migrations are additive and tested in both modes before any release; rollback
first disables MCP and preserves grants/audit history for controlled recovery.
Any live connection, grant or deployment change follows the applicable release
authorization and runbook.

## 7. M1 work and exit gate

| Issue | Deliverable | Status in this plan |
| --- | --- | --- |
| [WHO-467](https://linear.app/mikewhob-whome/issue/WHO-467) | Architecture, five-tool contract, data flow and implementation slices | Proposed here |
| [WHO-468](https://linear.app/mikewhob-whome/issue/WHO-468) | Consent, provenance, provider terms and policy review | Boundaries drafted; review remains |
| [WHO-485](https://linear.app/mikewhob-whome/issue/WHO-485) | Included-vs-add-on decision, enablement and cost guardrails | Included recommendation; owner decision remains |
| [WHO-486](https://linear.app/mikewhob-whome/issue/WHO-486) | Stable SDK/auth version selection, table/metadata design and parity validation | Design candidates identified; compatibility proof remains |

M1 closes only after the proposed contract and commercial policy are accepted,
the auth/SDK compatibility decision is evidenced, provider/data handling is
reviewed and M2/M3 issues reflect the resulting implementation slices. No owner
decision is inferred from the time spent drafting. Runtime implementation begins
with WHO-469 after this gate, not by marking this proposal as shipped.

## Sources and verification limits

Repository files reviewed at the baseline above:
- `apps/api/src/app.ts`, `middleware/{auth,tenant,subscription}.ts`
- `routes/{shopping,chores,notes}.ts`, `lib/shopping.ts`
- `packages/auth/src/better-auth.ts` and its locked dependency version
- `packages/config/src/{index,subscription-access}.ts`
- `docs/HOSTED_RLS.md`, `deploy/Caddyfile.domi-ops.example`
- `packages/marketing-ui/src/legal.tsx`, `apps/www/src/lib/pricing-display.ts`
- `docs/marketing/{PRICING_TIERS,HOSTED_POSITIONING}.md`

Official references checked 2026-10-21:
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [TypeScript SDK Hono integration](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/hono/)
- [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)
- [Claude remote connector network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Google Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy?hl=en)
- [Homeschool Planet pricing](https://homeschoolplanet.com/homeschool-planet-subscriptions/)
- [Syllabird pricing](https://www.syllabird.com/pricing)

Source inspection and documentation research do not prove live compatibility,
Google approval, provider data-policy acceptance or billing configuration.
