# MCP gateway

WHO-471 adds the opt-in gateway after [authorization](MCP_AUTHORIZATION.md) and
[connection controls](MCP_CONNECTIONS.md). The same implementation serves self-host
and hosted packages. It is included in hosted base pricing and free for self-hosting;
there is no integration module, license check or add-on SKU.

## Enablement and routing

Keep `MCP_ENABLED=false` until the planned tool/client acceptance gates pass.
Demo mode always disables the gateway. Deployment enablement, household opt-in,
approved client profile and a member's affirmative consent are all required.
Disabling a household revokes its grants; enabling it again requires new consent.

Apply `0104_mcp_gateway` after `0103_mcp_authorization`, rerun the application-role
installer (`npm run db:create-app-role`), then upgrade API and worker together.
Use the existing deployment runbook/admin migration connection. Do not run the
application with migration-owner credentials. No new environment variables are needed.

Use one canonical `PUBLIC_APP_URL` origin, without a path/query/fragment. Issuer is
`PUBLIC_APP_URL/auth`; resource/audience is `PUBLIC_APP_URL/api/mcp`. Production and
provider-cloud connections require reachable HTTPS. This change opens no tunnel,
publishes no LAN service and does not change any live deployment settings.

| Path | Behavior |
| --- | --- |
| `/api/mcp` | Bearer-only POST; other methods return 405 with `Allow: POST` |
| `/.well-known/oauth-protected-resource/api/mcp` | Resource metadata for the exact audience |
| `/.well-known/oauth-protected-resource` | Same metadata for root discovery |
| `/.well-known/oauth-authorization-server/auth` | Existing authorization-server metadata |
| `/auth/.well-known/oauth-authorization-server`, `/auth/oauth2/*`, `/auth/jwks` | Existing maintained provider |

The self-host and hosted Caddy examples route exact MCP/discovery/provider paths to
`api:4000`, preserving public Host and Authorization. Caddy and API must share the
stack's proxy network; replace the service upstream with a unique alias if several
stacks share one external network. Ordinary web/browser routes keep their existing
upstream. Demo has no MCP route to the enabled app API.

For installations proxying everything through Next, `/api/mcp` has a fixed-upstream
route handler and protected-resource metadata has explicit rewrites. The bridge
preserves Host, Origin, Authorization, Accept and the modern `Mcp-Method`, `Mcp-Name`
and `MCP-Protocol-Version` headers. It strips cookies in both directions and retains
authentication challenges and `Retry-After`. It buffers bounded bodies and permits
no caller-selected upstream URL. Its deadline is 10.5 seconds, encompassing its
request/response reads and the API hop.

The API checks exact canonical Host including port, and exact full Origin when one
is present, before using the SDK's hostname checks. Non-browser clients may omit
Origin. Existing browser CORS/session rules remain unchanged. Missing/invalid bearer
tokens return an OAuth resource-metadata challenge; cookies cannot rescue them.
Disabled gateway and protected-resource paths return 404 before browser middleware.

## Protocol and approved surface

Dependencies are pinned in the API workspace:

```sh
npm install --save-exact -w @domi-ops/api @modelcontextprotocol/server@2.3.1 @modelcontextprotocol/hono@2.0.2 zod@4.6.7
npm install --save-dev --save-exact -w @domi-ops/api @modelcontextprotocol/client@2.3.1
```

Use the SDK's `createMcpHandler` with `legacy: "stateless"`. A fresh server is created
for each exchange, with the same authorization and tool registry for both formats.
Modern 2026-07-28 requests require their envelope and matching standard headers.
2025 clients use `initialize` and `notifications/initialized`; no persistent session
is created. The SDK client defaults to that handshake; tests for the modern path
explicitly set `versionNegotiation: { mode: { pin: "2026-07-28" } }`.
Protected-resource discovery advertises the three read scopes and `offline_access`
for clients needing refresh. Advertising a scope never grants it: refresh still
requires an explicit requested scope and member consent.
See the [official SDK source](https://github.com/modelcontextprotocol/typescript-sdk)
and [protocol specification](https://modelcontextprotocol.io/specification/2026-07-28).

Only server discovery, tool listing/calls and protocol negotiation/probes are
accepted. No persistent sessions, subscriptions, resources, prompts, sampling,
jobs, shell, SQL or arbitrary URL fetch tools are exposed. The response mode is
automatic JSON for modern requests; the SDK may frame finite legacy responses as
SSE. The approved handlers emit no notifications and subscription methods are
rejected before dispatch. GET/DELETE remain unsupported.

WHO-471 introduced `get_connection_context`. It returns this
connection's own household/member labels, timezone, scopes and current tool name;
there is no roster, email or private record content. Returned labels are untrusted
data, never instructions. Strict input `{}` rejects caller-supplied identities.

WHO-472 adds shopping, chore and explicitly selected-note tools through
[purpose-built read queries](MCP_READ_TOOLS.md). They are now registered alongside
the context tool and filtered by scope/current module entitlement. New handlers
must use pure bounded domain reads, declare scope/module policy,
and check current record ACLs inside the supplied transaction. Do not wrap existing
shopping/chore list routes: they can materialize recurrence and send notifications.

## Authorization and bounds

The bearer branch runs before cookie, tenant and method-based subscription
middleware. Every request verifies the signed token and live immutable grant;
every tool call verifies them again inside a short user/household transaction,
taking a shared grant lock and rechecking membership, granted role and household
enablement. There is no positive authorization cache or tenant transaction spanning
transport/client interaction. Tool discovery filters by token scope. Domain tools
must also declare their module and use the current hosted module entitlement.

Logical reads remain permitted for a canceled/read-only hosted subscription when
the module remains entitled. Transport POST does not imply a product write.
Future writes must call `subscriptionAllowsWork`; the current registry rejects all
write tools even for paid or self-hosted households. Audit/rate metadata writes
are allowed for reads. Tenant content never uses worker/system scan context.

| Bound | Value |
| --- | --- |
| Pagination helper | Default 25, maximum 50 records (domain tools in WHO-472) |
| Note chunk contract | 6,000 characters (WHO-472 must apply it) |
| Request / complete JSON response | 64 KiB / 32 KiB |
| End-to-end API deadline | 10 seconds, including authentication and body reads |
| Database tool statement / lock wait | 1.5 seconds / 1 second |
| Tool idle transaction | 8 seconds |
| Concurrent admitted requests per connection | 2 |
| Requests per minute | 30 per connection, 120 per household |

Counters use fixed UTC minute windows, shared across API replicas via a household
metadata row lock. These limits count authenticated HTTP requests, including
discovery/protocol/invalid tool requests, rather than only successful domain reads.
Fixed windows permit a boundary burst. Throttling returns 429 and `Retry-After`.
Concurrency denial consumes the rate budget. Admission leases release after work
settles; a crashed process's lease expires after 30 seconds. A timed-out upload is
canceled. No later domain read starts after the deadline; already-running database
statements settle under their short database timeout before releasing admission.

Output schemas and serialized size are checked before release; the complete HTTP
body is checked again to include protocol overhead. Oversized output returns a
bounded failure. Authorization/tool failures reveal no private record existence.
No bearer, argument, returned content or raw protocol/database error is logged.

## Activity and deletion

`mcp_access_events` stores actor user, connection (attributable to its immutable
client/member/household grant), approved tool or static `protocol` tag, outcome,
request ID, duration, byte count and timestamp. Invalid raw tool names, arguments,
tokens, labels and private content are excluded. Events remain private to the
connection owner under RLS. Rate denials coalesce to one event per connection/minute
to bound audit growth; ineligible/unauthenticated requests get no fabricated actor.
An admitted request must record its activity; failed finalization withholds results.

The worker runs fixed metadata cleanup on startup and every minute, even with MCP
disabled, with overlap protection. At most eight bounded batches run per tick, with
5-second database statements and 1-second lock waits. Multiple workers coordinate
with a transaction advisory lock. The UI excludes events older than 30 days even
before a sweep; physical deletion follows the bounded sweep and can lag under load.

- Audit events: delete after 30 days.
- Pending consent: delete after its existing expiry (at most 10 minutes).
- Admission leases/windows: delete expired leases and minute buckets older than two minutes.
- Expired connections: irrevocably revoke. Purge tombstones only after connection
  expiry, at least five minutes since revocation, no remaining audit rows and all
  issued refresh/opaque access credentials have expired. Unknown expiry is retained
  conservatively. A late-issued refresh token can outlive the grant's absolute
  30-day access ceiling, so deletion must wait for its own expiry.

**Do not delete rotated refresh rows belonging to an active grant.** Provider-row
deletion triggers grant revocation. Cleanup removes provider artifacts only for
already-eligible revoked grants, in bounded batches, then deletes the empty grant
and its selections/pending state. This prevents token resurrection and accidental
revocation during ordinary rotation.

Maintenance uses `app.mcp_prune_expired_metadata()`: fixed SECURITY DEFINER SQL,
pinned search path, no arguments, count-only result and no PUBLIC execute grant.
The application-role installer grants access after migration. This narrow deletion
capability adds no worker/system read policy or arbitrary tenant query interface.

## Verification

Run from the repository root:

```powershell
pwsh -NoProfile -File scripts/test-mcp-auth.ps1
```

The runner creates disposable PostgreSQL 16, applies the complete migration chain,
installs the NOBYPASSRLS app/provider roles and generates an ephemeral loopback TLS
certificate. Only the test child processes trust that certificate; no certificate
is installed in Windows and TLS verification stays enabled. Credentials, key files
and the owned container are removed afterward. A direct Vitest run without the TLS
environment still supports loopback HTTP fixtures.

Local verification on 2026-10-22: 94 explicit auth/database/RLS regressions passed
across single/shared modes, including real HTTPS OAuth/discovery, official modern
SDK calls, the Next bridge forwarding to HTTPS, cookie stripping, strict scope/input
validation, result bounds, 10-second slow-upload cancellation, live role/subscription
checks, shared concurrency/rate budgets and active-rotation/tombstone retention.
The regular suite passed 1,494 tests with 904 environment/database tests skipped;
these do not replace the explicit PostgreSQL run. All 17 typecheck tasks, targeted
web ESLint and Next production build passed. Both Caddy templates validated with
Caddy 2; their actual public deployment paths are still a rollout acceptance gate.

No live household, provider account or deployment was modified. Production edge
acceptance, actual ChatGPT/Claude/Gemini compatibility and domain ACL/content tests
remain WHO-472 and the later client/dogfood acceptance milestones. Local HTTPS is
protocol evidence, not vendor approval or a deployed-household acceptance claim.
