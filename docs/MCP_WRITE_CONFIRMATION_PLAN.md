# Reviewed MCP writes: original contract and test plan (WHO-479)

Status: implementation authorized, 2026-10-27; live writes remain disabled.
The [current implementation guide](MCP_REVIEWED_WRITES.md) supersedes the original
design findings and proposed decisions below. They are preserved as design history,
not claims about the present schema or tests.
The owner explicitly requested returning to WHO-479 after the read-only hosted
checks, Claude connector publication and OpenAI submission. This is a go-ahead
to build the foundation, not to enable writes, widen existing grants or claim
completed normal-use usefulness/repeat-use/cost measurements. Those remain unknown.
The preserved design is now based on merged main `0e6fdb8`; synthetic and hosted
fictional acceptance remain distinct from real household usage evidence.

## Original starting point (2026-10-23)

- [Gateway](../apps/api/src/mcp/gateway.ts) rejects write registrations and batch
  arrays. [Tool names](../apps/api/src/mcp/tools.ts) are the five approved reads.
- [Operation policy](../apps/api/src/mcp/access.ts) checks logical subscription
  eligibility and then rejects every write with `writes_not_enabled`.
- [Authorization](../packages/auth/src/mcp.ts) grants read scopes plus refresh
  lifecycle only. Existing grants, including consent policy v3, authorize no writes.
- Existing shopping/chores routes use recurrence and notification/karma helpers.
  They are not automatically safe adapters for assistant mutations. WHO-480 must
  review individual domain operations and their intended effects separately.

## Proposed authority and flow

1. **Prepare:** a bearer-authenticated, explicitly write-scoped client proposes
   one allowlisted operation. Derive household/member/client/grant identity from
   authorization, never tool arguments. Check current role, record sharing,
   module and logical subscription eligibility. Preparation stores a bounded
   private intent and returns an opaque ID, expiry and canonical Domi Ops review
   link. It changes no household/domain data and triggers no jobs/notifications.
2. **Review:** a real Domi Ops browser session must belong to the intent's member.
   Show provider, household, exact records, before/after values and any intended
   effects from the server-owned intent. Escape labels/content as untrusted data.
   Never use model prose as the authoritative preview. No confirmation on GET,
   auto-submit, prechecked acceptance or caller-selected redirect.
3. **Confirm:** a deliberate same-origin browser POST carries a one-use review
   nonce and the displayed intent digest. The authenticated session, member,
   client, immutable grant, target records, operation version and exact payload
   must all match. A tool argument such as `confirmed:true`, conversational yes,
   skill instruction or possession of an intent ID is insufficient authority.
4. **Revalidate and commit:** reload live grant, policy/profile, membership,
   scopes, permissions, module and subscription eligibility. Lock the intent and
   affected records and compare their expected state before applying anything.
   The proposed default is that browser confirmation executes the approved local
   mutation atomically, without another model-controlled apply step. Confirm the
   adapter/transaction contract before implementation; no handler exists yet.
5. **Report:** record a bounded attributable result receipt and return status to
   the authorized client. Recheck authority before status/replay retrieval; a
   cached success must not disclose data after revocation or permission loss.

Adding write scopes requires fresh operator/profile review and member consent;
never expand a read grant or reinterpret `offline_access`. Keep read-only hosted
subscriptions' existing reads/security controls working, but deny write preparation
and execution when `subscriptionAllowsWork` rejects them. The self-hosted path
uses the same member/record checks; no Cloud license or paid integration gate.

## Intent binding, expiry and concurrent edits

Proposed fields: opaque intent ID; household/member/user/client/connection IDs;
issuer/resource; policy/profile/operation-schema versions; canonical payload digest;
target IDs and expected revisions/state; creation/expiry; nonce hash; lifecycle and
result reference. Store only the minimum payload required to render/apply the
review, protected by household/member RLS and the existing encryption mechanism.
The detailed schema, encryption binding and indexes require implementation review.
Do not put payloads, titles, cookies, tokens or review nonces in audit/log rows.

Proposed initial review lifetime is at most five minutes, bounded by the grant's
remaining lifetime. It is a design starting point, not a measured usability result.
An expired intent, changed target, changed payload or changed authority requires a
new preview and fresh confirmation. Never silently refresh a preview's validity or
overwrite a concurrent human edit. A digest binds the exact canonical operation,
including omitted/default/null values; a digest alone does not prove authorization.

## Retry and failure semantics

Use a DB-enforced idempotency key scoped to household, member, client and immutable
grant, bound to the canonical operation digest. Same key/different operation is a
conflict; identical text is not an idempotency key. A different grant after reconnect
cannot revive an old intent. Missing, expired or purged intents never execute.

Under a transaction/row lock, only one confirmation may move a pending intent to
its committed result. Commit the domain mutation, minimal result receipt and any
explicitly approved transactional outbox entry together. Domain state and receipt
must agree after rollback. Two deliveries cannot apply twice or produce duplicate
outbox entries. This does not promise exactly-once external notification delivery.

If the client loses the response, resolve by the same intent/key after authority
checks. A transport timeout is not proof of rollback. For an unknown DB commit
outcome, expose an indeterminate/pending reconciliation state and inspect the
persisted receipt; do not run the operation again with a new key automatically.
Any external effect that cannot fit the reviewed atomic/outbox contract stays out.

Keep a short-lived protected intent payload and metadata-only receipts/tombstones
long enough for the agreed retry/retention window. Proposed receipt retention is
30 days, aligned with current access metadata, subject to privacy review. Purging
a receipt must never turn an absent intent into permission to reapply it.

## Required acceptance matrix before shipping

Run on restricted non-SUPERUSER/non-BYPASSRLS single and two-household shared modes,
then the authorized target's proxy/client flow. These are planned tests, not passes.

| Scenario | Required outcome |
| --- | --- |
| Read-only grant, canceled/read-only subscription, disabled module | No write preparation/execution; ordinary permitted reads remain available |
| Foreign household/member/client/grant or another member's browser session | No confirmation, mutation, receipt or record-existence disclosure |
| Model `confirmed:true`, GET, cross-site POST, missing/reused review nonce | No authority to execute |
| User denies or abandons review | No domain/queue/notification change |
| Payload/default/target/operation-schema changed after preview | Stale/conflict result; new preview and confirmation required |
| Human edits/deletes a target during review | Expected-state conflict; preserve the human change |
| Role, sharing, grant, consent policy, module or subscription changes before commit | Fresh denial, no partial mutation |
| Two simultaneous confirmations / duplicate delivery | One domain effect and one attributable receipt/outbox entry |
| Same idempotency key with different payload | Conflict, no second effect |
| Lost response after commit | Authorized same-intent lookup returns the existing receipt without reapplying |
| Timeout or unknown commit outcome | Indeterminate/reconciliation state; no automatic new-key retry |
| Transaction/outbox failure and bounded execution timeout | Atomic rollback or persisted committed receipt; never invented success |
| Revocation or record-visibility loss before receipt retrieval | No cached sensitive result disclosure |
| Payload/nonce/credential canaries, long/untrusted text and batches | No raw values in logs/audit; current bounds and batch denial retained |

## Scope and remaining decisions

### Repository-specific implementation requirements

- Shopping items and chores in [core schema](../packages/db/src/schema/core.ts)
  have no revision column or general last-modified timestamp. Do not use
  `created_at` as proof that the target is unchanged. For the first adapter,
  compare the complete operation-relevant before-state under a row lock. If
  the contract must detect an edit followed by a restoration to the same values,
  add a monotonic revision maintained by every writer, including background jobs;
  value comparison alone cannot detect that history.
- `withGrantContext` already holds a `FOR SHARE` lock on the grant, serializing
  its updates with the current transaction. Its membership and other eligibility
  checks do not establish locks on every authorization input. A write transaction
  needs an explicit serialization contract with revocation, membership, sharing,
  household enablement and subscription changes. Define the commit ordering and
  deterministic lock order, then test real competing transactions. A standalone
  authorization check immediately before an update cannot prove this property.
- Existing `encryptSensitive` accepts a value and key, with no associated-data
  argument. Bind the intent's identity, operation version and digest inside its
  authenticated encrypted envelope and validate them after decryption against
  the row, or select a reviewed context-binding primitive. Do not claim the
  existing encryption call alone prevents cross-row ciphertext substitution.
- The existing calendar outbox is specific to calendar sync, an excluded domain.
  Reusing it or directly enqueueing a job before the write transaction commits
  would violate this contract. Initial adapters must have no external effect,
  or introduce an independently reviewed transactional outbox for their exact
  approved effect. A generic queue adapter is not already implemented.

These requirements are design findings, not runtime changes or test results.

### Remaining scope decisions

No deletions, role/membership changes, grades, medical data, Google-derived content,
Google-sync actions, arbitrary URL fetches or autonomous/bulk writes. WHO-480 owns
the reviewed shopping/chore allowlist and matching skills after this foundation.
The owner must review actual pilot value/support/cost evidence and give a dated
go/no-go before the write milestone begins implementation. Then resolve the
operation/revision model, intent storage/retention, transaction/outbox adapters and
confirmation UX in a concrete implementation review. Existing runtime behavior
remains read-only until those gates are cleared.
