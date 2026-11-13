# Assistant capabilities and direct actions: pilot spec

Status: **direction accepted by the owner, 2026-11-11** (decisions in section 11).
Acceptance of this document is not a go-ahead to enable anything on a deployment or to
change a provider listing. Stages 0, 1, 2 and 4 are implemented, and stage 3's packages,
listing drafts and acceptance plan are prepared (section 12). Nothing is enabled,
deployed or submitted, and no provider client has called the new tools. Written against `origin/main` at `e944ebb`. Live deployment state, provider
review status and provider-side confirmation behavior were not verified for this draft.

This spec covers Claude, ChatGPT and Grok Bot. It supersedes the browser-confirmation
requirement of [reviewed writes](MCP_REVIEWED_WRITES.md) for a small set of routine
actions only. Reviewed writes stay as the path for anything not listed here.

## 1. Goal and the trade this spec makes

Make an assistant connection useful for everyday household requests ("add milk", "am I
free Thursday afternoon", "log my morning meds") without sending the provider anything
the member did not deliberately choose to share.

The integration gets its usefulness from **actions and status**, and its privacy from
**never sending content**. An assistant can log a medication group without ever learning
what is in it. That is the design in one sentence, and each rule below follows from it.

Privacy rules that hold for every tool, on every provider:

1. **Enumerated fields only.** Each tool returns a fixed field list defined in this
   document. No tool returns a free-text health field, and no tool has a "details" mode
   that is not listed here.
2. **Off until chosen.** Shopping and chores reads are offered pre-selected at
   connection time. Everything else, and every action, starts off.
3. **Labels are chosen, not inherited.** Where a name must cross to the provider (a
   medication group), the member sees the exact text first and may replace it with an
   alias.
4. **References are opaque and connection-bound.** A reference names a target that Domi
   Ops resolves under current permissions. Holding one grants nothing.
5. **Live checks on every call.** Grant, role, module, subscription, capability,
   selection and record ownership are re-read inside the call's transaction.
6. **Returned text is data.** Nothing a tool returns can widen authority, and action
   tools accept no free text except a shopping item title.
7. **Nothing sensitive in operations.** Activity rows, logs, errors and telemetry carry
   tool names, outcome classes and counts. Never labels, titles, times or arguments.

What this does not hide: medication *timing* and *whether a group was logged* are
personal information in themselves. The consent screen says so in plain words. This
spec describes the result as privacy-filtered, not anonymous.

## 2. Permission model

Three layers, all of which must allow a call:

| Layer | Set by | Changes how |
| --- | --- | --- |
| **Deployment ceiling** | Operator, in environment config | Redeploy |
| **OAuth scope** (per module, coarse) | Provider client requests; member approves at connect | Reconnect to widen; narrow any time |
| **Connection capability and selection** | Member, per connection | In Domi Ops, with a signed-in session |

### 2.1 Why capabilities are not scopes

Today the granted scopes must equal the scopes the client requested
(`sameScopes` in [mcp.ts](../packages/auth/src/mcp.ts)). A member cannot untick chores
at connect time, and cannot enable anything the client did not ask for. Provider
packages are static, so per-member choices cannot live in the scope list.

Scopes therefore become the **outer bound** for a connection, and a new per-connection
capability table holds what the member actually turned on. A scope with no enabled
capability authorizes nothing.

New scopes: `calendar:read`, `health:read`, `health:write`. `shopping:write` already
exists in the grant CHECK from migration 0105. Existing `shopping:read`, `chores:read`
and `notes:read` are unchanged.

| Capability | Requires scope | Module | Default at connect |
| --- | --- | --- | --- |
| `shopping.read` | `shopping:read` | core | on (member may untick) |
| `chores.read` | `chores:read` | core | on (member may untick) |
| `notes.read` | `notes:read` | core | off; explicit note selection as today |
| `shopping.add` | `shopping:write` | core | off |
| `calendar.availability` | `calendar:read` | calendar_sync | off; calendar selection required |
| `health.groups.read` | `health:read` | health | off; group selection required |
| `health.groups.log` | `health:write` | health | off; group selection required |

### 2.2 Rules

- **Existing grants gain nothing.** A grant issued before this change has no new scopes
  and cannot be given new capabilities. The member reconnects from the assistant to
  reach the new consent screen. Migration backfills capability rows only for the read
  scopes a grant already holds.
- **Do not bump `MCP_POLICY_VERSION` for this.** `liveConnection` denies any grant whose
  policy version differs from the current constant, so a bump disconnects every
  household at once. Capabilities carry their own `consent_version` instead.
- **Enabling a capability later is an in-app step, not a reconnect,** provided the
  connection already holds the scope. It needs a cookie session for the grant's own
  member, the same origin checks as the existing `/api/mcp-auth` controls, the preview
  from section 6 and an unchecked acknowledgment. This replaces "widening requires fresh
  consent" with "widening requires fresh consent *in Domi Ops*". Admins still cannot see
  or change another member's connection.
- **Turning anything off is immediate** and needs no acknowledgment.
- **Each connection is separate.** Enabling health on Claude does nothing to ChatGPT.
- **Adults only, own records only.** Eligible roles stay owner, admin and member. Health
  capabilities apply only to groups whose `memberId` is the connection's own member.
  Cross-member health access is out of scope for the pilot, including for admins.

### 2.3 Deployment ceiling

- `MCP_DIRECT_ACTIONS_ENABLED` (default false) and `MCP_DIRECT_ACTIONS`, an explicit
  list drawn from `shopping.add` and `health.groups.log`. Separate from
  `MCP_WRITES_ENABLED`, so turning on reviewed writes never turns on direct actions and
  the reverse.
- `MCP_READ_SCOPES` accepts the two new read scopes.
- The Grok Bot guard currently requires a shopping-and-chores-only read ceiling
  ([config](../packages/config/src/index.ts)) and its published policy allows only
  those scopes ([mcp-grok-bot.ts](../packages/auth/src/mcp-grok-bot.ts)). Both become an
  explicit per-provider scope ceiling so all three providers share one model while an
  operator can still hold a provider back.
- **Decided:** Grok Bot's ceiling excludes `health:read` and `health:write` until
  medication groups have passed acceptance on Claude and ChatGPT. It gets shopping add
  at the same time as the others.
- **Changed 2026-11-12:** with Claude and ChatGPT passed, the owner lifted that hold.
  Grok Bot's policy now allows the full set, calendar availability included, and still
  excludes selected notes. Its real client has not yet called the medication or
  calendar tools.

## 3. Data model

One migration. All tables are owner-scoped under the existing RLS pattern and cascade
from `mcp_connections`.

| Table | Columns | Notes |
| --- | --- | --- |
| `mcp_connection_capabilities` | connection, capability, detail level, consent version, enabled at | Row present means enabled. Deleting the row disables it. |
| `mcp_calendar_selections` | connection, calendar | Same shape as `mcp_note_selections`. |
| `mcp_med_group_selections` | connection, group, can read, can log, label mode (`name` or `alias`), encrypted alias, consented at | Only `scheduled` groups are selectable. |
| `mcp_med_group_member_consents` | connection, group, medication, state (`approved` or `excluded`), consented at | Composite FK to `health_medication_group_members` with cascade delete. |
| `mcp_action_events` | connection, action, outcome class, counts, internal target id, created at | Member-visible activity. Never sent to a provider. |

Plus one nullable column: `health_medication_logs.logged_via_connection_id`
(set null on connection delete), so dose history can show that an assistant recorded
the entry. `logged_by_user_id` stays the member.

### 3.1 Group membership consent

- Approval covers the medications in the group **at the moment of consent**. One row per
  medication is written as `approved`, or `excluded` if the member unticked it.
- A medication with **no row** is not approved. This is what a medication added to the
  group later looks like, so it never gains assistant access silently.
- The cascade means **removing a medication from a group deletes its consent row**.
  Adding it back requires approval again.
- **Explicit exclusion beats group access** and survives until the member changes it.
- When unapproved members exist, connection settings shows "2 medications were added to
  Morning since you approved this assistant" with a single Approve action.
- A medication in several groups has independent rows per group. Being approved in
  Morning says nothing about Night.
- **Schedule changes do not need re-approval.** Consent attaches to the group, and times
  are re-read live. They do invalidate outstanding occurrence references (section 5.4).

## 4. Direct action contract

A third execution mode beside read and reviewed. The tool-type split in the unmerged
WHO-480 worktree (`execution` on `McpTool`) is the right base for this and should be
carried over. Its `prepare_*` tools implement the browser-confirm flow and are not part
of this pilot.

1. **Authority.** Runs inside `withWriteGrantContext`, which already takes the authority
   locks and rechecks role, policy, profile, grant and hosted subscription.
   `checkOperation` gains a direct mode that requires the action to be in
   `MCP_DIRECT_ACTIONS`, and its module parameter stops being hardcoded to `core`.
2. **Then, in the same transaction:** capability row, selection row, record ownership,
   domain eligibility, the write, and the `mcp_action_events` row.
3. **One transaction, all or nothing on technical failure.** A failed statement aborts
   the transaction, so there is no partially saved state to describe. Partial results
   come only from *access* (section 5.5).
4. **Retries are safe by construction, not by key.** Assistants are unreliable at
   carrying idempotency keys across turns, so neither pilot action needs one. Dose logs
   are deduplicated by the existing unique index on medication and scheduled instant.
   Shopping adds are deduplicated against open items (section 5.2).
5. **Responses separate four cases:** saved, nothing to do, not permitted, and not
   saved. A deadline or lost response says the outcome is unknown and that repeating the
   same call is safe.
6. **Annotations.** `readOnlyHint: false`, `destructiveHint: false`,
   `idempotentHint: true`, `openWorldHint: false`. Providers may add their own
   confirmation for non-read-only tools. That is theirs to decide, and section 8 tests
   for it.
7. **Budget.** Existing limits (30 calls a minute per connection, two concurrent) plus
   10 direct actions a minute per connection.

A tool call proves delegated authority and a valid target. It cannot prove what the
member said. That is why direct actions are limited to ones that are additive, narrow
and easy to reverse in the app. No direct action deletes, overrides, skips, edits or
reaches another person.

## 5. Pilot tools

All three providers get the same tools. `get_connection_context` reports enabled
capabilities instead of raw scopes.

### 5.1 `list_shopping_items` and `list_chores`

Unchanged, apart from requiring their capability row.

### 5.2 `add_shopping_item`

| | |
| --- | --- |
| Input | `title` (1 to 120 characters, single line, no control characters), `quantity?`, `unit?` |
| Output | `outcome`: `added` or `already_on_list`; the item's id, title, quantity, unit |
| Not accepted | notes, cost, tags, aisle, recurrence, checked state |

- If an unchecked item with the same normalized title exists, nothing is written and the
  existing item is returned. This makes retries harmless and gives the assistant
  something true to say.
- `created_by_display_name` records the member and the assistant, for example
  "Sam via Claude", so the rest of the household can see where an item came from.
- The current route is a plain insert with no notification, recurrence or karma effect.
  The adapter must stay that way.

### 5.3 `get_calendar_availability`

| | |
| --- | --- |
| Input | `from`, `to` (household-local dates, at most 14 days) |
| Output | Merged busy intervals: `start`, `end`, `allDay`. Coverage flags. |
| Never returned | Titles, descriptions, locations, attendees, categories, calendar names, event counts, event ids, which calendar an interval came from |

- Only calendars the member selected **and** can currently see contribute.
- Overlapping and adjacent events merge into one interval, and drive buffers are folded
  in. The assistant cannot tell one long event from three back-to-back ones.
- Recurring events are expanded read-only. The existing `persisted_records_only`
  coverage contract would report a recurring commitment as free time, which is worse
  than not answering. This tool reports its own coverage value.
- Health and chore overlays never appear.
- Read-only for the pilot. No event creation.

**Open: Google-sourced events.** Events with `source = "google"` are Google user data.
Sending availability derived from them to an AI provider needs a review against Google's
API Services User Data Policy before it ships, the same concern that led note reads to
omit linked content. Until that review is done, this tool uses local events only and
returns `externalCalendarsExcluded: true` so the assistant says the answer may be
incomplete. For a household that lives in Google Calendar this makes the tool weak.

**Decided:** availability is built after medication groups, and its scope (include
Google-sourced events, ship local-only, or defer) is settled once the policy has been
read. No availability work starts before that review.

**Changed 2026-11-12, at the owner's direction to complete every stage:** availability
is built in the local-only form described above. Google-sourced events are excluded in
code, not by configuration, so the policy review is still required before they can be
included but no longer blocks the tool. See section 12, stage 4.

### 5.4 `get_medication_group_schedule`

| | |
| --- | --- |
| Input | `day`: `today` (default), `yesterday` or `tomorrow` |
| Output | Per selected group: `label`, and per occurrence `occurrenceRef`, `localTime`, `status`, and counts if the detail level allows |
| Never returned | Medication names, strengths, forms, instructions, notes, per-medication status, history, supply, pharmacy, prescriber, standalone doses, other groups, other members |

- `label` is the group name or the member's alias, at most 40 characters.
- `status` is one of `pending`, `taken`, `partly_taken`, `skipped`, `mixed`.
- Status is computed over the group as the member knows it: current, enabled, in-date
  members whose own times include that occurrence. Paused medications are left out.
- Detail level `status_only` returns no counts. `status_with_counts` adds `total` and
  `notAccessibleToAssistant`. The consent text states that counts reveal how many
  medications are in a group.
- `occurrenceRef` is signed like the existing cursors and binds the connection, group,
  local date, time and a digest of the group's schedule. It expires at the end of the
  following local day.

### 5.5 `log_medication_group`

| | |
| --- | --- |
| Input | `occurrenceRef` only |
| Output | `outcome`, `label`, `localTime`, `logged`, `alreadyRecorded`, `notAccessible` |
| Not possible | Skipping, marking missed, undoing, editing, notes, PRN doses, standalone doses, interval groups, any time not on the group's schedule |

The existing `POST /medication-groups/:id/log-all` is **not** the adapter. It accepts any
caller-supplied instant, logs every enabled member regardless of that medication's own
times, runs outside a transaction and returns raw error messages. The shared
`recordDose` writer underneath it is sound and is what this tool calls.

At write time, inside the transaction:

1. Verify the reference and that it belongs to this connection.
2. Re-read the group. If its schedule digest differs, or the occurrence no longer
   exists, write nothing and return `target_changed`. The assistant re-reads and checks
   with the member.
3. Allow only occurrences on the household's current local date or the previous one.
4. Compute the instant with `zonedLocalToUtc`, the same helper the app uses, so
   assistant and in-app logs collide on the unique index instead of duplicating.
5. Eligible medications are group members that are enabled, not deleted, within their
   start and end dates, scheduled at that time on that weekday, owned by the
   connection's member, and `approved` for this connection and group.
6. Call `recordDose` with `source: "bulk"` and status `taken` for each. Existing entries,
   including deliberate skips, are left untouched and counted as `alreadyRecorded`.
7. Members that fail only the approval check are counted as `notAccessible`.

Outcomes: `logged` (at least one saved), `nothing_to_log` (all already recorded),
`not_permitted` (none accessible; nothing saved), `target_changed`, `not_saved`.
The assistant is told to report the three counts as they are and never to say the whole
group was logged when `notAccessible` is above zero. With `status_only`, counts are
replaced by `complete: true | false`.

Membership changes between read and write do **not** invalidate the reference. The
member asked for "my morning meds", the assistant never saw the members, and a newly
added medication shows up as `notAccessible`.

Safeguards specific to health, because a false "taken" could lead someone to miss a
real dose:

- Each assistant-recorded group produces an in-app activity entry ("Claude recorded
  Morning as taken, 3 doses") with the normal per-dose controls to correct it. A push
  notification for these is on by default and can be turned off.
- The tool records the member's report. Tool text and receipts say "recorded", never
  that the assistant confirmed the medication was taken.
- It only fills gaps and only for a two-day window, so a manipulated or confused
  assistant cannot rewrite history or pre-log the week.

**Departure from the handoff:** the earlier plan asked the assistant to disambiguate
when a group and a standalone dose share a time. The assistant cannot see standalone
doses, and telling it they exist leaks them. Instead the receipt always names the group
label and time, so the member sees what was logged. **Decided:** the labeled receipt is
the pilot behavior. A coarse `otherDosesScheduledToday` flag stays a possible follow-on
only if pilot use shows the receipt is not enough.

## 6. Consent and preview

- The connect screen shows shopping and chores pre-selected, then a collapsed
  "More access" section with everything else off.
- **The preview is the real payload.** For each capability being enabled, the screen
  renders the actual serialized tool response for the member's current data, labeled
  "This is what the assistant will receive". There is no separately maintained
  description that can drift from the code.
- Group selection lists the member's scheduled groups with Read and Log checkboxes per
  group, the label that will be shared, an alias field, and the member medications with
  a checkbox each (shown only to the member, never sent).
- Health capabilities add one acknowledgment: timing and logging status will be sent to
  the named provider and kept under that provider's terms.
- The existing provider-settings review step stays for all three providers.
- Connection settings shows every capability, selection and recent activity, with
  per-item off switches and the existing Disconnect.

## 7. What is recorded and what is not

| Place | Contains | Never contains |
| --- | --- | --- |
| `mcp_access_events` | Tool name, outcome, duration, bytes | Arguments, results |
| `mcp_action_events` | Action, outcome class, counts, internal target id | Labels, titles, times as text |
| Dose log row | Member, connection id, status, instants | Assistant conversation |
| Application logs and error reporting | Error class, request id | Any tool argument or result; raw domain errors |
| Tool error text | A fixed message per outcome class | Record values, internal ids, exception text |

## 8. Acceptance

Run on fictional data first, separately on each provider's normal client.

- All pilot tools work end to end, and each provider's own confirmation behavior for
  non-read-only tools is recorded. "Finishes in chat" is claimed per provider only where
  observed.
- A captured response for every tool matches the field lists in section 5 exactly.
- Medication groups: fully approved, partly approved and wholly unapproved groups return
  correct outcomes and counts. Paused members are ignored. A prior skip is preserved.
- A medication added after consent is not logged until approved. Removed then re-added
  needs approval again.
- A schedule change between read and write returns `target_changed` and writes nothing.
- Repeated and concurrent calls, overlapping groups, and an in-app log for the same
  instant produce exactly one dose row per medication.
- Capability off, selection removed, grant narrowed or revoked, role change and module
  or subscription loss each take effect on the next call.
- References from another connection or household are rejected identically to unknown
  ones.
- Instruction-like text placed in shopping titles, chore titles and group labels does
  not cause any tool to act outside its inputs.
- A grep of application logs, activity tables and error reports after the full run
  finds no label, title or medication text.
- The dedicated `scripts/test-mcp-auth.ps1` matrix covers the new tables under the
  restricted database roles in single and shared modes.

Private acceptance, a real-household pilot, enabling the flags on a deployment, and
marketplace approval are four separate outcomes. Adding non-read-only tools is expected
to require resubmitting the published listings.

## 9. Build order

| Stage | Contents | Proves |
| --- | --- | --- |
| 0. Foundation | Capability table, tool-type refactor, direct mode, activity, consent and settings UI, preview. Status in section 12 | The permission model, with no new data exposed |
| 1. Shopping add | `add_shopping_item` | The direct action contract on the least sensitive target |
| 2. Medication groups | Group selection and consent UI, schedule read, group log, attribution column. Claude and ChatGPT only | The privacy model where it matters most |
| 3. Provider acceptance | Section 8 for stages 1 and 2 on each client, then listing updates. Grok Bot health follows a pass on the other two | What each client actually does |
| 4. Availability | Google data policy review first, then `get_calendar_availability` in whatever scope the review allows | Whether availability is useful enough to ship |

## 10. Later modules

The same three layers apply. Each module below needs its own field list and review
before any work starts.

| Module | Likely first step | Main privacy question |
| --- | --- | --- |
| Chores, Notes | Complete one chore occurrence; create a private note | Recurrence, karma and notification side effects; note text is free text |
| Goals, Expenses, School | Check-ins; budget totals; assignment planning | Student identity, grades, merchants and receipts stay out by default |
| Drive, Reports, Notices | Selected file links and summaries | File names are sensitive; reports must not bypass source limits; notices reach other people and need their own action permission |
| Calendar, Health follow-ons | Event creation; standalone doses; health checks | External sync effects; individual medication identity |

## 11. Decisions (owner, 2026-11-11)

| # | Question | Decision |
| --- | --- | --- |
| 1 | In-app widening (2.2) | Accepted. Capabilities can be enabled in Domi Ops without a reconnect, within scopes the connection already holds |
| 2 | Counts (5.4) | New group selections default to `status_with_counts`, disclosed in consent. `status_only` remains available |
| 3 | Standalone-dose ambiguity (5.5) | Labeled receipt. No extra flag in the pilot |
| 4 | Logging window (5.5) | Today and yesterday, household-local |
| 5 | Push on assistant-recorded doses (5.5) | On by default, member can turn it off |
| 6 | Google-sourced availability (5.3) | Availability moves after medication groups. Scope decided after the policy review |
| 7 | Grok Bot and health (2.3) | Held back until medication groups pass on Claude and ChatGPT. Lifted 2026-11-12: full set |
| 8 | WHO-480 | Carry over the tool-type refactor. The `prepare_*` reviewed tools are not continued as part of this work |

Still open, and not blocking stages 0 to 2: the Google data policy review, and each
provider's own confirmation behavior for non-read-only tools.

## 12. Implementation status

### Stage 0, backend (built, not deployed)

- Migration `0108_mcp_capabilities`: `mcp_connection_capabilities` and
  `mcp_action_events`, owner-scoped RLS, a 90-day pruning function for activity, and a
  backfill that gives existing grants rows for the reads they already hold.
- Config: the capability map, `MCP_DIRECT_ACTIONS_ENABLED` and `MCP_DIRECT_ACTIONS`.
  `shopping:write` is advertised only when an operator lists `shopping.add`.
- Consent writes capability rows. Requested reads are the default; the prepare call
  accepts an explicit subset. Actions are never a default.
- `POST /api/mcp-auth/connections/:id/capabilities` lets the grant's own member switch
  capabilities within the scopes the connection holds. Adding one needs
  `acknowledged: true`; removing is immediate. Narrowing a scope removes the
  capabilities it bounded.
- Every tool checks its capability inside the call's transaction, and tool listing
  filters by it. `get_connection_context` reports a scope only while something is
  switched on under it. The value format is unchanged, so published briefing skills
  keep working.
- Direct execution mode in the gateway: authority locks through
  `withDirectActionContext`, operator ceiling, capability, a budget of 10 actions a
  minute, the write and its activity row in one transaction. Non-read-only
  annotations. Error text separates "nothing was saved" from "saved but not returned".
- Stage 0 reserved the name `add_shopping_item` without registering a tool. Stage 1
  below registers it.

Verified with `scripts/test-mcp-auth.ps1` on 2026-11-11: 219 tests in 7 files passed
under the restricted database role in single and shared modes, including the new
`mcp-capabilities.integration.test.ts`. The regular suite and all 17 typecheck tasks
passed. The backfill ran against an empty table only; it has not been exercised on a
database that already holds connections.

### Changes from the plan above

- Section 3 listed the calendar and medication-group selection tables and the dose
  attribution column in one migration. They move to the stages that use them, so a
  self-hoster never carries tables whose design can still change.
- Section 2.1's new scopes (`calendar:read`, `health:read`, `health:write`) and modules
  beyond `core` are added with stages 2 and 4, not here.
- Section 2.3's per-provider ceiling for Grok Bot is a one-line policy change that
  belongs with stage 1, when its listing metadata changes.

### Stage 0, interface (built, not deployed)

- Consent screen: requested reads are pre-selected checkboxes the member can untick,
  each with what it shares in plain words. Actions sit in a collapsed "More access"
  section and start off. The note picker appears only while note reading is ticked.
- "See what the assistant receives" calls `POST /api/mcp-auth/capabilities/preview`,
  which runs the real shopping or chores tool for the signed-in member, limited to
  three records, and shows its exact JSON. No grant is involved and nothing is sent.
- Connection settings: a "Switched on" list, a "Change access" form that requires the
  acknowledgment only when something is being added, and "Recent actions by this
  assistant" built from outcome classes.
- "Reduce access" is now "Remove permissions" and still narrows the OAuth grant.

Checked by hand on 2026-11-11 against a disposable local stack with fictional data, at
desktop and 375 px widths: a real authorize request through consent with chores and
notes unticked and the shopping action ticked, the stored capability rows, adding a
read with the acknowledgment, removing an action without it, and the activity list.
No console errors and no horizontal overflow. `scripts/test-mcp-auth.ps1` passes 221
tests in 7 files.

### Stage 1, shopping add (built, not deployed)

- `add_shopping_item` is in the default registry
  ([direct-tools.ts](../apps/api/src/mcp/direct-tools.ts)). It is listed and callable
  only when the operator lists `shopping.add` in `MCP_DIRECT_ACTIONS`, the connection
  holds `shopping:write`, and the member has switched the capability on.
- Input is a single-line name of up to 120 characters, with an optional quantity and
  unit. Control characters, line separators and bidirectional overrides are refused.
  Any other field is refused by the strict schema.
- An unchecked item with the same name, ignoring case and spacing, is returned as
  `already_on_list` and nothing is written. An advisory lock per household and name
  makes two simultaneous requests produce one row. A checked-off item does not block a
  new one.
- The row gets `created_by_display_name` such as "Sam via Claude". The shopping list
  now shows it as "Added by ...", so the household can see where an item came from.
  The item serializer returns that field for every item.
- Grok Bot's policy now allows `shopping:write`. It stays ungrantable until an operator
  enables the action, and the settings page only suggests scopes that provider's policy
  accepts.

Verified on 2026-11-11. `scripts/test-mcp-auth.ps1`: 227 tests in 7 files, covering
the add, deduplication, refused inputs, the concurrent case and the unchanged second
household. Against a disposable local stack, a real OAuth grant and JSON-RPC calls
through the web bridge returned `added`, `already_on_list` for a differently cased
name, and a validation error for a two-line name; the shopping page then showed one
new row with its "Added by" line.

Not done in stage 1, and each needs its own go-ahead:

- No provider package, listing or briefing skill was changed. The published Claude and
  ChatGPT packages still request read scopes only, so no real assistant can reach this
  tool yet.
- No real Claude, ChatGPT or Grok Bot client has called it. Whether a provider adds its
  own confirmation prompt for a non-read-only tool is still unobserved.
- `docs/MCP_GROK_BOT.md` still describes Grok Bot as read-only.

### Stage 2, medication groups (built, not deployed)

- Migration `0109_mcp_med_group_selections`: the `health:read` and `health:write`
  scopes, `mcp_med_group_selections`, `mcp_med_group_member_consents` (with the cascade
  from group membership) and `health_medication_logs.logged_via_connection_id`.
- Config: `health:read` is accepted in `MCP_READ_SCOPES` but is never a default, and
  `health.groups.log` is accepted in `MCP_DIRECT_ACTIONS`. `MCP_WRITE_SCOPES`, the
  reviewed-write ceiling, still accepts only shopping and chores.
- Capabilities `health.groups.read` and `health.groups.log`. Logging requires reading.
  Neither is ever pre-selected, in the API or on the consent screen. A household that
  switches its health module off loses the health tools and keeps the rest of the
  connection.
- [med-groups.ts](../apps/api/src/mcp/med-groups.ts) holds the whole model: the
  member's own fixed-time groups only, labels cleaned to one line of 40 characters,
  signed connection-bound occurrence references that expire after 36 hours, and the
  eligibility rule from section 5.5.
- `get_medication_group_schedule` returns, per shared group, a label, whether it can be
  logged, and per occurrence a reference, a local time, a status and optional counts.
  An occurrence with nothing due is left out.
- `log_medication_group` takes only a reference. It records `taken` for approved
  medications through `recordDose` with `source: "bulk"`, for today or yesterday, and
  returns `logged`, `nothing_to_log`, `not_permitted` or `target_changed`.
- Group choices are made on the consent screen and in Change access: which groups, the
  label to share, logging per group, count sharing per group, and which medications are
  covered. The preview shows the schedule tool's own output for unsaved choices.
- Connection settings reports medications added to a shared group since approval, and
  saving Change access approves them in one step with the acknowledgment.
- Each assistant-recorded group leaves an in-app notice and an activity row. Neither
  holds a label, a time or a medication name.

Verified on 2026-11-12. `scripts/test-mcp-auth.ps1`: 245 tests in 8 files, including
`mcp-med-groups.integration.test.ts` in both deployment modes. Against a disposable
local stack with fictional data: consent through the real screen stored exactly the
chosen group, exclusion and capabilities; a medication added afterwards showed as
waiting and was approved through Change access; over real OAuth and JSON-RPC the
schedule returned one occurrence with 6 due and 1 not accessible, logging returned 5
logged and 1 not accessible, a repeat returned nothing to log, and an altered reference
returned `target_changed`. No medication name or strength appeared in any response.
The Health page then showed the five doses as taken with Edit and Undo.

The click-through found three defects that are fixed: the consent screen pre-ticked
medication reading, a long signed reference made the page scroll sideways, and the
"added since approval" notice stayed after approval.

Differences from sections 3 and 5:

- Count sharing is a per-group switch (`share_counts`), not a connection-wide detail
  level. A selection row always means read access; `can_log` adds logging.
- The in-app notice is written every time and cannot be turned off. A push is sent
  after the action commits and honors the member's existing "health reminders" push
  preference, so there is no new setting. The push carries the same content-free text.
- The Health page's logged-dose row says "recorded by an assistant". A member's own
  correction to that entry clears the mark.
- A reference that cannot be verified returns `target_changed`, the same as a changed
  schedule, so an invalid reference reveals nothing about why it failed.

Not done in stage 2:

- No published provider package, listing or the briefing skill was changed, and no real
  assistant client has called these tools. A draft actions skill exists (see below).
- At this stage Grok Bot's policy did not allow the health scopes. Since 2026-11-12 it
  allows the full set, which also removes the open question of what its client does on
  a deployment that advertises them: every advertised scope except notes is now
  grantable to it.
- Interval-schedule groups, standalone doses, skipping and other members' groups.

### Written 2026-11-12, tests run and passing the same day

At the owner's direction the following was written and compiled, with the test runs
left for a separate pass. That pass ran later the same day: typecheck 17 of 17, 1,674 unit tests, 22 package tests and 269 database tests in 9 files all pass. After the push notice tests were added: 1,679 unit and 271 database tests. After Grok Bot was widened: 1,681 unit and 273 database tests.

- Code: the post-commit hook for direct actions in the gateway, `pushDoseNotice`, the
  "recorded by an assistant" label, clearing the mark on a member's own edit, and
  `ON CONFLICT DO NOTHING` on the 0108 backfill.
- Unit tests: `apps/api/src/mcp/med-groups.test.ts`, `direct-tools.test.ts`,
  `actions-skill.test.ts`, and new cases in `apps/web/src/lib/mcp.test.ts`.
- Integration tests: the 0108 backfill replay in `mcp-capabilities.integration.test.ts`
  (needs `MCP_TEST_ADMIN_DATABASE_URL`, which `scripts/test-mcp-auth.ps1` sets), and
  assistant attribution in `mcp-med-groups.integration.test.ts`.
- [skills/domi-ops-household-actions/SKILL.md](../skills/domi-ops-household-actions/SKILL.md):
  a skill for the two actions and the medication schedule, separate from the published
  read-only briefing skill. Stage 3 added calendar availability to it and wired it into
  the package builders.

Push delivery to a real device has no automated test: it needs push credentials and a
subscribed device. Everything up to the delivery call is covered, including a failed
delivery, which the gateway reports with the tool, the connection id and the error class
and never the error text.

Browser check, 2026-11-12, disposable local stack with fictional data (core, health and
calendar_sync, all scopes advertised): the consent screen showed the medication group and
calendar pickers, and ticking a calendar showed the exact response, with the two back-to-back
events merged into one 13:00 to 15:00 block, the all-day entry as its own block and no title,
location or calendar name. After an assistant logged a group over real OAuth and JSON-RPC,
Health showed each dose as "recorded by an assistant" with Edit and Undo, the alert held no
label, time or medication name, and AI connections listed the action and the shared calendar,
with Change access showing the picker's current choice. The Grok Bot card listed only
`shopping:read chores:read shopping:write offline_access` on a deployment that also advertises
health and calendar. Not seen: a real provider client, push delivery, a phone-width layout.
The fixture's household timezone must match the browser's, or doses appear under the wrong
slot; that is a fixture artifact, not a defect.

### Known gaps

- The preview covers shopping and chores. Notes are shown by title in their picker.
- Switching note reading on later gives the assistant the note tools with whatever
  notes were selected at connect time, which may be none. Adding notes still needs a
  new approval.
- Closed in stage 4: a connection prepared by an older API build during a rolling
  deploy now gets the reads it approved (migration 0110).
- The 0108 backfill has not yet run on a deployment that holds connections. A replay
  test passes, and the before-and-after count check for the deploy is in part 1 of
  `MCP_ASSISTANT_ACTIONS_ACCEPTANCE.md`.

### Stage 4, calendar availability (written and tested 2026-11-12)

- Migration `0110_mcp_calendar_availability`: `calendar:read` joins the grant scope
  CHECK, and `mcp_calendar_selections` holds one row per shared calendar under the same
  owner-scoped RLS as the other selection tables.
- Config: `calendar:read` is a read scope an operator must list in `MCP_READ_SCOPES`.
  Capability `calendar.availability` belongs to the `calendar_sync` module, is a read,
  and is never a default at consent.
- `get_calendar_availability` in `apps/api/src/mcp/calendar-availability.ts`. Input:
  `from` and optional `to`, at most 14 days, within 31 days back and 366 forward of the
  household's today. Output: `coverage`, `recurringExpanded`,
  `externalCalendarsExcluded`, `truncated` and `busy`, a list of `start`, `end`,
  `allDay`.
- Only calendars the member selected and can still see contribute. A calendar made
  private, archived or deleted drops out on the next call.
- Repeating events that are not stored yet are expanded in memory. Nothing is written.
- Consent and AI connections have a calendar picker with the same "See what the
  assistant receives" preview, showing the next seven days.

Differences from section 5.3:

- `start` and `end` are local wall-clock minutes in the household's timezone
  (`2026-11-12T14:00`), not instants. The assistant answers "Thursday afternoon"
  without timezone arithmetic, and no seconds or offsets leave.
- Timed events merge with each other and all-day entries merge with each other, but the
  two are kept apart. Folding a birthday into the same block as a meeting would make a
  whole day read as busy.
- `externalCalendarsExcluded` is true only when a selected calendar holds Google-sourced
  events, not always. Repeating events that originated in Google are excluded as well.
- `coverage` is `no_calendars_selected` when nothing is shared, so an empty answer is
  never mistaken for free time.

Also in this stage:

- **Rolling-deploy guard.** `mcp_connections.capability_consent_version` is set by every
  build that writes capability rows. A trigger gives a new grant without it the reads
  its scopes name, as the 0108 backfill did. It never switches on an action, health or
  calendar access. The trigger can be dropped once no older build can run.
- **Fix:** "Remove permissions" rejected any connection holding more than four scopes.
  The bound is now twelve.

### Stage 3, provider packages and acceptance (prepared 2026-11-12, not run)

- Packages are version 0.2.0 for all three providers and carry a second skill,
  [household actions](../skills/domi-ops-household-actions/SKILL.md), beside the
  unchanged briefing skill.
- Claude: `scripts/mcp-claude/package.mjs` and the committed portal source in
  `integrations/claude/domi-ops-household`. Claude takes its scopes from the server.
- ChatGPT: `scripts/mcp-chatgpt/package.mjs` accepts the action scopes. A package
  requests exactly the scopes it is given, and the deployment must offer the same set.
- Grok Bot: `scripts/mcp-grok-bot/package.mjs` accepted `shopping:write` on top of the
  shopping read and refused health and calendar scopes (decision 7). Since 2026-11-12
  it accepts the full set and refuses only notes.
- `scripts/mcp-review/materials.mjs` writes five positive and three negative review
  cases for any scope set, a recording outline and release notes.
- The submission drafts default to shopping, chores, shopping add, medication groups and
  calendar availability. Notes stay out, as in 0.1.x. A narrower set is one argument.
- The public privacy policy's assistant section (`packages/marketing-ui/src/legal.tsx`)
  now describes actions, medication timing and calendar availability. It needs the
  owner's review before it is published.
- [Tests, acceptance and store update](MCP_ASSISTANT_ACTIONS_ACCEPTANCE.md) lists every
  automated test, the per-provider manual checks for section 8 and the submission
  steps.

Not done, and not possible from a development machine: running section 8 against real
Claude, ChatGPT and Grok Bot clients, recording what each shows for a non-read-only
tool, deploying, switching a flag on, and submitting.
