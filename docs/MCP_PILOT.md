# Bounded assistant pilot (WHO-478)

Status: prepared, not run. No real-household onboarding, repeat use, usefulness
score, support cost or infrastructure cost has been measured by this issue.
Synthetic results in the three provider guides remain separate evidence.

## Order and entry gates

1. Reviewed source and green restricted-role `single`/two-household `shared`
   matrices, including canceled hosted reads, exact issuer/resource isolation,
   revoked grants, disabled modules and absence of domain/queue/notification
   side effects. Record the actual build SHA, not only a historical test count.
2. Exact account/profile acceptance and privacy review; reviewed real-client
   provisioning procedure; target backup/recovery plan; explicit deployment
   authorization. See [setup](MCP_SETUP.md). Unresolved gates keep real access off.
3. Owner's self-hosted household, one consenting adult and one approved client
   first. The owner prefers Gemini and approved risk disclosure plus informed
   opt-in instead of a provider ban. Gemini is the proposed first pilot surface;
   actual member consent to the selected account/data scope is still required.
   Confirm current provider handling and show the versioned disclosure before data.
   Start with shopping/chores and no notes. Any later note is deliberately
   selected and checked for excluded content. This is a proposed cohort, not
   evidence that consent or deployment already happened.
4. Review the self-host receipt before a separate hosted pilot. Hosted needs its
   own opted-in household, restricted-role target, canonical issuer/resource and
   entitlement checks. Do not infer hosted acceptance from the self-host pilot.
5. Record a release/expansion decision. General enablement, public publication,
   Google-derived data, Health and reviewed writes remain separate approvals.

Before starting, agree a finite UTC start/end and household timezone, one named
operator and participant, the one client, approved record scope and stop contact.
Do not begin an open-ended pilot with an end date to be decided later. Let the
participant choose whether to return for another briefing; reminders or background
jobs are not part of this integration. At the end disconnect and verify denial,
unless continued access is separately authorized and documented.

## Observations and evidence

Copy the [record template](templates/MCP_PILOT_RECORD.md) into an access-controlled
operator location such as ignored `.qa/mcp-pilot/`. Do not commit real records,
transcripts, account identifiers, endpoint callbacks or credential material.
Ignored is not encrypted: protect the local folder and share only redacted
aggregates. Synthetic evidence can be referenced by CI link/SHA and provider guide.

| Measure | How to record it without household content |
| --- | --- |
| Onboarding | Count consented participants, attempted connections and working context-first briefings separately. Record elapsed minutes, manual help and static failure category. Show numerator/denominator; exclude synthetic rehearsals. |
| Usefulness | Ask the participant whether the briefing helped and what was missing; record a voluntary rating/reason without task titles, note text or identities. No response is unknown, not a positive score. |
| Repeat use | Count distinct participant-chosen sessions/days in the agreed window; distinguish assisted troubleshooting and operator tests. Zero repeats is observable; no follow-up opportunity is unknown. |
| Support | Operator minutes and interaction counts by setup/auth/permissions/provider/other category. Include failed and abandoned attempts. No transcript collection is required. |
| Infrastructure | Compare equal-duration baseline and pilot windows on the same target: API CPU/memory, DB load and metadata growth, calls, durations, bytes and denial/rate events. Record source/window and unrelated traffic. Do not infer incremental cost from total server spend. |
| Cost | Record actual billed deltas when attributable, or an explicitly labeled estimate with units, rate source and assumptions. Record unavailable telemetry as unknown. Provider subscription cost and Domi Ops infrastructure/support are separate. |

Existing activity contains tool/static outcome, duration, bytes, timestamp and
request attribution; it contains no raw arguments/results. It cannot establish
usefulness or repeat intention. Audit retention is 30 days with bounded cleanup;
retain only the necessary aggregate receipt under the agreed pilot handling.
Do not enable a payload logger or add household analytics to fill measurement gaps.

The gateway's engineering ceilings remain two concurrent admitted requests per
connection, 30/120 requests per minute per connection/household, 10 seconds per
API exchange and bounded rows/chunks. These include protocol requests, not only
domain reads, and are not pilot performance targets or unlimited usage promises.
Record 429/retry outcomes honestly; do not raise limits to make onboarding pass.

## Stop checks

Stop immediately for unexpected identity/data, excluded domains, a domain write,
notification/job side effect, credential disclosure, failed revocation, privacy
setting drift, participant withdrawal or material household-service degradation.
Disconnect the grant/household and use the [feature stop](MCP_SETUP.md#disconnect-disable-and-rollback)
where needed. Preserve metadata-only evidence and report the narrow observed
failure. Do not repeat real-data linking attempts until the cause and fix have
bounded synthetic evidence. Do not promise deletion of provider-side copies.

Routine end-of-window checks: working read before disconnect; explicit disconnect;
next actual assistant read denied; fresh consent required to reconnect; ordinary
session and Google connection unaffected. Scope reduction and disconnect need
separate before/after cases if both are claimed independently. Test shared-host
negative/isolation cases on synthetic tenants, never another customer's records.

## Decision record

Current decision: **hold real-data rollout pending entry gates**. No real pilot
results exist yet. A synthetic pass does not justify reviewed writes or expansion.
For each completed target, record observed value, repeat opportunity/use, support
burden, attributable cost, limitations and the owner's dated decision: stop,
extend the same bounded read-only pilot, or propose a separately authorized next
step. There is no invented success threshold or automatic deployment decision.

Recheck the actual Google provider-review status through its authoritative
console/notice before any applicable public release. Recording submitted is the
owner's confirmed fact; approval remains unverified in this preparation. The
native-data pilot cannot clear the M6 Google-content gate. Hosted base inclusion
and free self-hosting are already approved and do not depend on inventing a paid
add-on or selling provider inference credits.
