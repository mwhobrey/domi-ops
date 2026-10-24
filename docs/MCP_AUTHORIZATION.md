# MCP delegated authorization (WHO-469)

Implemented locally on the v0.11.3 baseline. No deployment, real client registration,
Google token change or production migration was performed. This is the authorization
foundation for [M1's contract](MCP_M1_DECISIONS.md); the connection/consent UI is
WHO-470, now implemented locally in [AI connection controls](MCP_CONNECTIONS.md).
The MCP transport/tools remain WHO-471–473. Keep the feature off until those pieces
and the client acceptance gates are ready.

## Same implementation in every deployment

Standard integrations are included in the existing hosted price and free for MIT
self-host. There is no integration SKU, license check, inference allowance or required
Cloud authentication broker. `single`, `shared` and `dedicated` use their own canonical
`PUBLIC_APP_URL`, issuer `/auth`, audience `/api/mcp`, database and encrypted keys.
The server never derives an issuer or audience from forwarded/client host headers.

`MCP_ENABLED=false` is the default. Opt-in requires HTTPS at the canonical origin;
HTTP loopback is accepted for development/test only. A household owner/admin must
also enable the integration, and each eligible adult grants their own consent.
`MCP_SYNTHETIC_DEPLOYMENT=true` is an operator assertion that a **separate deployment
contains only synthetic data**, never a way to label a real household synthetic.
Gemini's original evidence is synthetic-only. WHO-478 permits a reviewed native-data
profile after explicit provider-risk disclosure and fresh versioned consent.
Exact live household acceptance remains a separate pilot gate.

Hosted read-only subscriptions retain approved read access, consistent with M1 and
the existing read/export policy. This issue adds no paid entitlement. WHO-471 must
enforce subscription policy by the tool's logical operation, never by MCP's HTTP POST.

## Installation and migration

Production dependencies are Better Auth, core and OAuth provider **1.7.10**, with
better-call **1.4.2**. Ordinary login retains username, existing models and Google
credentials; the provider/JWT plugins are only installed when MCP is enabled.
The generic browser-session `/auth/token` route is disabled. Exact install command:

```sh
npm install -w @domi-ops/auth --save-exact better-auth@1.7.10 @better-auth/core@1.7.10 better-call@1.4.2 @better-auth/oauth-provider@1.7.10
```

`jose@6.2.12` is an API **development-only** dependency for negative, signature-valid
JWT fixtures: `npm install -w @domi-ops/api -D --save-exact jose@6.2.12`.

Migration `0103_mcp_authorization` is additive and journaled. Apply with the existing
deployment migration procedure before using the new binary. The migration operator
must be allowed to create/grant the `domi_ops_oauth` non-login role. It rejects an
existing role with LOGIN, SUPERUSER or BYPASSRLS. For hosted, the existing
`deploy/deploy-hosted.sh --migrate` sequence reapplies `db:create-app-role`, which now
grants role membership and removes direct credential-table privileges. This document
does not authorize running that deployment.

Self-host's migration operator receives membership directly. A self-host that uses
a separate restricted application login must grant it membership in `domi_ops_oauth`
and the application-table grants using the same operator-controlled role setup.
Never point the running hosted API at the migration/admin URL to bypass a grant error.

The provider adapter uses short transactions with `SET LOCAL ROLE domi_ops_oauth`
only for provider models. That role can access credential metadata, clients, keys,
consents and token artifacts; it has no users, sessions or domain-table grants.
The ordinary auth adapter handles existing identity/session models. Context helpers
restore roles and transaction-local settings, including nested calls and failures.

Application grants use owner + household RLS. A verified user/reference permits only
the narrow pre-household connection lookup. Pending consents permit their authenticated
owner's identity lookup; no endpoint lists them. Neither system-bootstrap nor worker-scan
context grants access to these tables. Note selections have composite same-household
foreign keys; selection creation also checks the existing private/shared note ACL.
Domain tools must still recheck the ACL at read time (WHO-472/473).

## Registration and browser control API

Clients are deployment-operator approved and exact-redirect only. Manual clients
remain pre-registered; optional [Claude onboarding](MCP_CLAUDE.md) recognizes its
single published identity through an operator-enabled CIMD policy. ChatGPT's
independent opt-in similarly recognizes its exact stable identity/callback and
managed JWKS URL using `private_key_jwt`. The shared bounded resolver creates no
household grant; provider profiles and flags remain independent. No DCR or
arbitrary metadata/key retrieval is enabled. See [ChatGPT setup](MCP_CHATGPT.md).
Anonymous/authenticated DCR, client/resource administration over ordinary HTTP,
machine grants, arbitrary metadata lookup and automatic consent are disabled.

The trusted server-side entry point is `createBetterAuth(...).mcp.registerClient`.
It requires existing session headers and a bounded configuration: name, exact callback
URIs, public `none` or confidential `client_secret_post`/`client_secret_basic`, allowed
scopes, provider, profile version, data mode and explicit enabled state (default false).
Its request-local operator context allows the maintained provider's server-only
registration API; ordinary members cannot activate that context through HTTP.
The returned confidential secret is one-time operator output. Never put it in a URL,
Linear issue, browser storage or logs. Client-profile provisioning UI/CLI and real
provider-specific configurations are later setup work; no live client is provisioned.

Endpoints mounted under `/api/mcp-auth` run before the general cookie/tenant/subscription
middleware. They authenticate real browser sessions independently, enforce exact same
Origin and a 16 KiB body limit, and return `Cache-Control: no-store`. Cookie-only or
development auth bypass never authorizes an MCP tool request.

| POST path | Input and behavior |
| --- | --- |
| `/household` | `{householdId, enabled}`; current owner/admin only |
| `/consents/prepare` | `{householdId, oauthQuery, noteIds, adultAttested:true, privacyAttested:true, providerSettingsReviewed:true, policyVersion:"2026-10-23.v3"}`; notes default empty, maximum 100 accessible IDs |
| `/consents/decide` | `{pendingId, oauthQuery, accept}`; exact query/session/user binding and one-use consumption; success returns the approved provider redirect URI |
| `/connections/:id/revoke` | Session owner only; local revocation commits before provider cleanup; reports `providerCleanupComplete` separately |

Preparation verifies the provider-signed query with its public verification helper.
It requires one resource, exact callback/client, S256 and the allowlisted scopes,
and stores only the exact query hash. User, session, household, client, resource,
record selection and policy/profile versions are bound in server-owned rows.
Pending consent expires after at most 10 minutes. Two tabs never share a “last grant.”

Approval consumes pending state before calling the provider. A connection activates
only after successful provider code issuance. Failed/uncertain decisions are never
replayed automatically. The provider's supported `consentReferenceId` becomes the
immutable `domi_grant_id` claim, including after refresh. Direct HTTP consent/continue
calls cannot bypass application approval.

## Token and revocation contract

Access JWTs last 5 minutes, codes/pending consent 10 minutes and rotating refresh
tokens 30 days, with zero replay grace. `offline_access` enables refresh lifecycle
only. Connections have an absolute 30-day ceiling; reconnect requires a new grant.
JWT signing keys remain encrypted by the maintained JWT plugin using `SESSION_SECRET`;
client secrets and opaque/refresh tokens are hashed. The public JWKS exposes no
private material. Preserve the signing secret and keys across restarts; key rotation
must retain previous verification keys through the last live access-token expiry.

`auth.mcp.authorize(request, requiredScopes)` is the resource authorization primitive
for WHO-471. It verifies the access-token type, issuer, audience, signature, expiry,
issued-at age, required claims and 5-minute lifetime. The maintained verifier uses
the signed `azp` as canonical client identity when present. DPoP-bound tokens cannot
be used as ordinary Bearer tokens. It then reads the live grant/member/profile and
household/module settings on **every call**, with no positive grant cache. Returns
only trusted user/member/household/connection IDs and effective token scopes.
Missing/invalid credentials are 401; missing operation scope is 403.

Grant identity/consent fields cannot change. Scopes can narrow but cannot expand;
expansion/reconnect creates a new ID. A revoked grant cannot reactivate. Database
triggers revoke existing connections on membership/role/identity changes or household
opt-out. Reinstating a member or re-enabling a household does not revive old tokens.
Provider refresh-token revocation and token-family deletion/replay also revoke the
application grant, so signature-valid outstanding access JWTs are denied immediately.
Normal refresh rotation is distinguished from revocation and preserves the grant.
The maintained provider does not implement individual stateless JWT revocation;
disconnect the application connection or revoke its refresh token.

Revoked rows are tombstones; do not delete/reuse grant IDs before the latest issued
refresh token expires (which can extend beyond the connection's absolute access ceiling).
WHO-471 owns access-event recording and scheduled retention: metadata only, 30 days;
pending consent at most 10 minutes; no raw content, prompts, arguments or credentials.
WHO-470 adds connection listing, scope/selection narrowing and the consent UI;
see [AI connection controls](MCP_CONNECTIONS.md) for its implemented contract.
It must also bridge signed provider queries through fresh browser login using the
maintained client plugin and honor the provider's consent redirect after sign-in.
WHO-471 must revalidate authorization inside the short execution context before each
tool and must not retain a tenant transaction across transport/client interaction.

## Verification

Prerequisites: Docker, mise, and PowerShell 7.3+. After `npm ci`, run the
disposable PostgreSQL regression suite on Windows:

```powershell
./scripts/test-mcp-auth.ps1
```

It creates a labelled loopback-only PostgreSQL 16 container on port 55491 with no
volume, applies the **full real migration chain**, creates the restricted app role,
builds dependencies and tests both single/shared modes with two households. It also
runs credential sign-in, synthetic Google sign-in and RLS coverage regressions.
Environment variables are restored and only its own labelled container is removed.
`MCP_TEST_ADMIN_DATABASE_URL` is used solely to simulate a failed provider cleanup
grant in the disposable test. Normal execution uses NOBYPASSRLS throughout.

Coverage includes public/confidential PKCE, signed-query tampering, two consent tabs,
session/household isolation, consent rejection/expiry/replay, missing attestations,
private/foreign note selection, code replay, rotation/refresh replay, local/provider
revocation, cleanup failure, role changes, reinstatement, scope expansion/narrowing,
wrong issuer/audience/client/user, expired/missing-expiry JWTs and DPoP binding.

These are application/database and loopback HTTP results. Real reverse-proxy/TLS,
provider accounts, actual MCP tool execution and production
acceptance are not established by this issue's tests.
WHO-470 implements the consent UI locally; its separate verification is recorded in
[MCP_CONNECTIONS.md](MCP_CONNECTIONS.md).

Final local verification (2026-10-21, PR review fixes): 60 database/auth regressions passed (50 MCP
tests across single/shared mode, plus 10 existing sign-in/RLS checks); repository
typecheck passed all 17 tasks; regular suite passed 1,479 tests with 860 database/
environment-dependent tests skipped; API build and tracked/new-file whitespace
checks passed. The database regressions above run separately and do not rely on
the regular suite's skipped integrations. All owned disposable containers were removed.
The review-fix run also covers concurrent consumption of each one-use credential,
automatic replacement of old grants despite cleanup failure, and ordinary session
access with MCP disabled and a prefixed application URL. Household opt-out revokes
the grant through its database trigger, so outstanding JWTs fail with 401.

Policy v3 requires a separate unchecked provider-settings review acknowledgment
for ChatGPT, Claude and Gemini. The server rejects omitted or false
acknowledgments before creating consent. The versioned privacy acceptance timestamp
records both settings review and risk acceptance; it does not verify settings
with the provider. Prior-policy grants and pending consents require fresh approval.
