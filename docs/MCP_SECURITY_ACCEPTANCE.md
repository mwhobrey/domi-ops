# MCP security acceptance

WHO-473 extends the authorization, gateway and [read-tool](MCP_READ_TOOLS.md)
regressions into an application acceptance matrix. Both single-household
self-hosting and shared hosted deployment modes run the same cases. Hosted base
pricing includes MCP and self-hosted availability is free; no add-on gate is used.

## Fixture and reproduction

Requirements: PowerShell 7.3+, Docker, repository Node 22 and installed npm
workspaces. The default local command uses mise:

```powershell
pwsh -NoProfile -File scripts/test-mcp-auth.ps1
```

For CI or a shell with the correct Node/npm already on PATH:

```powershell
pwsh -NoProfile -File scripts/test-mcp-auth.ps1 -UseSystemNode
```

The runner owns a disposable PostgreSQL 16 container on loopback port 55491,
applies the full migration history, and installs the real restricted application
and OAuth provider roles. Tests use NOBYPASSRLS application access, two synthetic
households, real Better Auth sessions, delegated consent/PKCE/JWTs and loopback
HTTPS with an ephemeral certificate trusted only by the child Node process.
It does not use permissive TLS validation or a live household database. The
runner removes its owned container and TLS files and restores process environment
variables on exit. The loopback port must be free.

The `test-mcp` job in `.github/workflows/ci.yml` runs this same explicit runner on
Ubuntu with setup-node and PowerShell. This job does not depend on production
secrets. The ordinary unit suite intentionally skips database acceptance without
its fixture variables; a green ordinary suite alone is insufficient evidence.

## Acceptance matrix

The existing fixture lives in
`apps/api/src/routes/mcp-authorization.integration.test.ts`; the additional WHO-473
cases are registered from `apps/api/src/mcp/acceptance-cases.ts`. Cursor integrity
and foundational RLS/authorization cases remain separate files in the runner.

| Boundary | Executed assertions |
| --- | --- |
| Deployment and routing | Real application factory mounts bearer MCP before browser tenant/subscription middleware; a conflicting valid browser cookie cannot choose the household. Missing bearer fails despite a valid cookie. Disabled MCP and resource metadata return 404 while an ordinary modules route remains available. |
| Identity and consent | Owner/admin/member access; guest/child denial; stale role/member and missing/foreign/revoked grants; forged identity arguments, consent concurrency, scope narrowing, immutable grant/reference persistence and refresh after disconnect. |
| OAuth authority | Wrong issuer/audience, expired and malformed credentials, reconnect invalidating the old JWT, token rotation/replay, disabled generic token/machine grants and unapproved clients. |
| Shared database pool | Three rounds of concurrent reads from two households through a real two-connection pool. Following success and a tool failure, both distinct PostgreSQL backend connections have empty household/user context and the restricted app role; an unscoped audit read returns no rows. |
| Discovery and data visibility | Token scopes, deployment/household modules and hosted entitlement filter tools and execution. Canceled hosted subscriptions retain entitled reads. Private/shared/selected notes require fresh ACLs; private, foreign, unselected, missing and deleted note reads have identical HTTP tool errors without title/body/ID disclosure. |
| Read side effects | Thirteen domain/notification/outbox table snapshots remain unchanged, queue enqueue and notification delivery spies remain unused, and production MCP never enters browser tenant middleware or its after-commit hook. Recurring records are not materialized or advanced. Bounded security audit, rate-counter and lease writes are permitted. |
| Untrusted content | Selected plain note text containing hostile instructions is returned as untrusted data. Caller household/member/grant/client IDs, URL/file/SQL/shell inputs and unsupported protocol capabilities are rejected; foreign records remain inaccessible. A fetch guard rejects external network destinations during the injection scenario. Linked/embed/HTML note content is omitted without fetching. |
| Redaction | Captured application console output, MCP responses and connection audit rows omit bearer/refresh tokens, raw private parameters and a database failure canary; errors remain generic and denial metadata is recorded. |
| Resource bounds | Actual HTTP connection/household budgets return 429 with retry metadata; oversized requests and whole protocol responses stay bounded. Paging, JSON escaping, Unicode chunks, signed query/grant-bound cursors and expiry/content revision are tested. Missing cursor signing configuration fails closed. |
| Deadline and cleanup | A saturated one-connection pool returns 504 within the gateway deadline tolerance; releasing the blocker cannot start a tool callback or leave an admitted request lease. |

The production application and database are real in these fixtures. Queue and
notification functions are instrumented rather than connecting to delivery
services. Database factory instrumentation tracks real pools for cleanup; tenant
middleware instrumentation delegates to the real middleware and detects entry
and after-commit execution. Fault-injection cases use test-only tool registries,
never additional production capabilities.

## Evidence and limits

Local verification on 2026-10-22, based on WHO-472 commit
`16bc96fa72a2738f8d582178104b1881c27443c8`:

- Explicit PostgreSQL/HTTPS matrix: **127 passed**, five files, 84.70 seconds,
  using `-UseSystemNode` from a mise-provided Node 22 shell on Windows. The
  default mise runner also exercised the additional application cases before the
  final cursor-key regression was added. Owned container/TLS cleanup completed.
- Regular suite: **1,497 passed, 934 environment-dependent skipped**. The relevant
  database acceptance cases ran explicitly above rather than counting skips as
  evidence.
- Repository typecheck: **17 of 17 tasks passed**. CI YAML parsed and its dedicated
  MCP runner command was checked locally. The Ubuntu job has not run yet.

No production deployment or vendor approval is implied.

Prompt-injection assertions establish server authority and data boundaries. They
do not measure how a remote assistant obeys or interprets returned text. Console
and audit assertions cover the MCP application surface, not PostgreSQL server,
reverse-proxy, external provider or assistant logs. Pool tests establish isolation
at the exercised concurrency, not production load capacity. Record snapshots
cover the named fixture tables and instrumented delivery paths, not arbitrary
future side effects. Persisted-only recurrence coverage and conservative linked
note omission remain intentional restrictions.

Public edge/TLS/metadata behavior, real approved client/provider compatibility,
privacy review, skill behavior, self-hosted household dogfood and the separate
hosted pilot remain rollout gates. The new Ubuntu CI job also needs execution
after this change is published. Keep `MCP_ENABLED=false` on deployed installations
until the applicable gates pass. This issue adds no dependencies, migrations or
application environment variables.
