# Reviewed-write foundation (WHO-479)

The owner authorized implementation on 2026-10-27 after the read-only integration
work. This foundation is not deployed or enabled. It does not complete the
normal-use pilot's unmeasured usefulness, repeat-use or cost observations.

Hosted base pricing includes the integration; self-host availability remains free.
Both deployment models use the same member, grant and record checks. Hosted write
eligibility additionally requires `subscriptionAllowsWork` and module entitlement;
an entitled read-only subscription retains its existing reads.

## Release boundary

`MCP_WRITES_ENABLED` defaults to false. A true value requires MCP, a non-demo
deployment, the existing encryption key and an explicit `MCP_WRITE_SCOPES` ceiling
containing only `shopping:write` and/or `chores:write`. Write scopes are absent from
discovery while disabled. Existing read-only grants are never expanded.

The production operation registry is empty. No write MCP tool is registered and
the gateway still rejects write tool registrations. WHO-480 must review and
install the exact shopping/chore adapters, wire the proposal/status MCP tools,
update client policies/skills and pass cross-client acceptance before enabling
new scopes. The current published/submitted read-only provider packages are not
changed by this implementation. Do not enable the foundation flag as a shortcut.

Deletions, bulk clearing, roles/membership, grades, medical data, Google-sync
actions and arbitrary URL/command execution have no registered operation. Trusted
adapters must parse strict JSON inputs, authorize their targets, and use the
supplied transaction for local create/update effects only. No notifications,
queue calls or calendar-specific outbox are provided by this foundation.

## Authority and protocol

The shared implementation is in
[reviewed-writes.ts](../apps/api/src/mcp/reviewed-writes.ts), with bounded
[HTTP adapters](../apps/api/src/routes/mcp-writes.ts) and an
[authenticated review page](../apps/web/src/components/ai/AiChangeReview.tsx).

1. A verified bearer client proposes an allowlisted operation, parsed effective
   payload and idempotency key. Household/member/client/grant identity comes from
   authorization, never request selectors. Preparation changes only protected
   intent/activity rows and returns an opaque reference and canonical review link.
2. The original member opens `/ai/changes/<connectionId>/<intentId>` in Domi Ops.
   A session-authenticated, same-origin review POST loads server-owned before/after
   values, household, actor and assistant name. All values render as text. GET,
   possession of IDs or a model's `confirmed:true` cannot confirm a change.
3. The member checks an initially unchecked acknowledgment and deliberately
   confirms. The POST binds their current browser session, review nonce, exact
   preview digest, immutable grant, operation version and target revisions.
   Repeated rendering in the same session does not rotate away its own nonce.
4. The transaction revalidates current role, scopes, policy/profile, household,
   module, subscription and record permissions; locks and compares targets; then
   applies the local mutation and commits its minimal receipt/activity together.
   A changed target/version requires a new proposal. A declined or expired intent
   cannot execute. No model-controlled apply endpoint follows browser approval.
5. The client can fetch status using its original live grant. A committed receipt
   contains no record values. Its encrypted target references are reauthorized
   before retrieval, so permission loss cannot expose a cached result.

Bearer endpoints are `POST /api/mcp-writes/prepare` and `/status`. Browser endpoints
are `POST /api/mcp-writes/browser/<connectionId>/{review,confirm,reject}`. Inputs are
strict; browser actions require the canonical Origin and reject cross-site calls.
Replies are not cached. Other methods cannot approve or execute a change.

## Transactions and retries

Write transactions acquire shared authority locks in this order: household,
browser session (when present), actor membership, household MCP setting,
subscription (hosted), OAuth client/profile, and grant. They then lock the intent
and targets sorted by kind/ID. Competing authorization edits either commit first
and are observed, or wait until the approved transaction ends. Deadlocks/timeouts
fail without an automatic operation replay. Adapters must preserve this ordering
and review any additional dependencies they introduce.

Shopping items and chores have database-maintained monotonic `revision` counters.
Every UPDATE advances them, including worker updates and edits restored to the
same values. Created timestamps and value equality are not revision substitutes.

The DB uniqueness constraint scopes the hashed idempotency key to the immutable
grant; the encrypted envelope additionally binds member/client, exact operation,
policy/profile, digests, intent ID and expiry. Same key/different effective payload
is a conflict. Concurrent confirmation produces one mutation and one receipt.
An identical delivered confirmation can retrieve that receipt, never apply again.

An unknown/lost response is not evidence of rollback. The UI disables another
save until the member checks this same intent's authoritative status. Pending
status requires fresh deliberate confirmation; committed status returns its
receipt. Missing/purged references never execute, and a reconnect cannot revive
an old intent. There is no automatic new-key retry or external-effect guarantee.

## Bounds, encryption and retention

- Preview lifetime: at most five minutes and never beyond grant expiry. Execution
  checks expiry again after applying, before recording success; failure rolls back.
- Strict request limit: 16 KiB. Canonical JSON: 24 KiB, depth 20 and 2000 nodes.
  At most 10 targets and 20 bounded before/after fields; no caller HTML or URLs.
- At most 20 live pending and 500 retained intents per grant. SQL statement/lock
  deadlines remain bounded; these are engineering ceilings, not pilot metrics.
- Payloads use the existing authenticated encryption and a validated identity
  envelope. Cross-row ciphertext substitution is refused. The completed payload
  is replaced immediately by encrypted target references only. Activity contains
  attribution/outcome and a session hash, never arguments, values, cookies or nonce.
- Fixed bounded pruning removes expired pending payloads/nonces, then intents and
  their activity after 30 days. It has no caller-controlled tenant/TTL/content
  selector and no worker-scan access to proposals. Pruning cannot authorize replay.

## Migration and verification

Migration `0105_mcp_reviewed_writes` adds the owner-scoped intent/event tables,
revision columns/triggers and the permitted write-scope names to the grant CHECK.
Run it as the migration administrator, then re-grant the restricted app role using
the existing procedure. Keep write flags off. Back up before any separately
authorized rollout; no live deployment is part of this worktree change.

The dedicated `scripts/test-mcp-auth.ps1` runner includes the reviewed-write tests
under TLS and non-superuser/non-BYPASSRLS roles in single and shared modes. The
only operation used there is a fictional adapter installed in the test application.
It is not a production action. Cases cover foreign identity/session/client/grant,
CSRF and GET, expiry, revisions and concurrent edits, simultaneous confirmation,
token revocation, authority locking, payload binding, rollback, timeout, retained
receipts and lost responses. Record actual final run counts in the runbook/PR.

The review component also has an ignored fictional UI fixture for unchecked
approval, new-proposal reset, escaped text, decline, expiry and uncertain-response
reconciliation at desktop and phone widths. UI-fixture observations are separate
from the real PostgreSQL authorization/transaction tests.
