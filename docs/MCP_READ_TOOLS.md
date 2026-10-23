# Read-only MCP tools

WHO-472 adds native household reads to the [MCP gateway](MCP_GATEWAY.md). Hosted
and self-hosted deployments use the same tools and authorization model. Hosted
base pricing includes the integration; self-hosted availability is free. The
deployment flag stays off until later isolation/client/pilot acceptance gates.
There are no new dependencies, migrations or environment variables in this issue.

## Surface and fields

Only the five approved tool names are registered. Schemas are strict: callers
cannot supply household, member, grant or client IDs, SQL, commands, URLs or unknown
options. Identity comes from the verified delegated connection. Native record IDs
are references within that identity's current permissions, not authorization.

| Tool | Inputs | Allowed result fields |
| --- | --- | --- |
| `get_connection_context` | `{}` | Existing own labels/timezone/granted scopes and currently permitted tool names; no roster/email |
| `list_shopping_items` | `checked: open` (default) or `all`, `cursor?`, `limit?` | ID, title, quantity/unit, checked, aisle, shortening flag, shopping-page link |
| `list_chores` | `status: open` (default), `completed` or `all`, `dueBefore?`, `cursor?`, `limit?` | ID, shortened first-line title, completion state, persisted due date, assigned member display label, shortening flag, chore highlight link |
| `list_selected_notes` | `cursor?`, `limit?` | Selected and currently visible note IDs/titles, title-shortening flags and notes-page links |
| `get_selected_note` | `noteId`, `cursor?` | Selected and currently visible note ID/title, bounded native text, omission/shortening flags and notes-page link |

Shopping requires `shopping:read`, chores require `chores:read`, and both note
tools require `notes:read`. Every domain tool declares module `core`. Discovery
and the context tool filter availability by token scopes and current deployment,
household and hosted module entitlement. Tool execution repeats those checks in
the live grant transaction. Hosted canceled/read-only subscriptions still permit
entitled logical reads; there are no product writes.

Common domain envelope:

```json
{
  "schemaVersion": 1,
  "retrievedAt": "2026-10-22T12:00:00.000Z",
  "householdTimezone": "America/Chicago",
  "coverage": "persisted_records_only",
  "contentTrust": "untrusted",
  "data": [],
  "nextCursor": null,
  "truncated": false
}
```

All returned text is untrusted data, including labels, titles and note text. It
must never supply instructions or widen a tool's authority. The service performs
no model calls, content-based commands, external URL fetches or attachment expansion.

## Persisted coverage and field exclusions

Queries use existing rows only. They do not create recurring shopping/chore
occurrences, advance templates/due dates, complete chores, reset reminders, earn
karma, enqueue jobs or deliver notifications. Unmaterialized recurring occurrences
are outside coverage. A persisted overdue recurring chore retains its stored due
date even when a normal app page would roll it forward. Do not describe these
results as a complete forecast of everything due.

`dueBefore` is an inclusive valid ISO local date in the household timezone. Undated
chores are excluded when it is supplied. No UTC conversion or inferred due date is
introduced. Lists use stable ascending record IDs and keyset pagination rather
than a relevance ranking or a point-in-time database snapshot. Concurrent inserts
with IDs before a cursor require a fresh list to discover.

Shopping omits costs, receipts, free-text item notes, creator information, recurrence
templates and arbitrary tags. Only the reserved `aisle:` tag is interpreted; invalid
or oversized tag storage has no arbitrary-tag fallback. Titles, units and aisles
are bounded and `fieldsTruncated` reports shortening/omitted oversized tags.

The chore schema calls its task label `description` and has no separate title.
The MCP query returns at most the first line as `title`, bounded to 256 UTF-16 units,
with `titleTruncated=true` for multiline/longer values. Raw description, later lines,
tags, priority, karma, reminder state and creator information are excluded. CR/LF
boundaries are both respected. Assignee display labels use member name/account
display name only, without email fallback or a separate roster response; revoked
or foreign-household assignees are not exposed.

Returned record IDs are stable references. Shopping/notes link to their real list
pages because those pages have no record-specific navigation. Chores use the
existing `/chores?highlight=<id>` navigation. Links are built from canonical
`PUBLIC_APP_URL`; no caller-provided host or URL enters the result.

## Notes and live permissions

Every note read requires BOTH explicit selection for this immutable connection AND
current visibility: household-visible, created by this member, or currently shared
with this member. Household administration gives no extra private-note permission.
Foreign, private, unselected, deleted and inaccessible continuation reads return
the same unavailable response. Removal from selection or loss of sharing takes
effect on the next call, including the next text chunk. Note titles are also ACL
filtered. No other member's selections are reused.

Text is read from the note row, never from a file/Drive attachment or a linked
Google resource. The schema has no reliable native/Google provenance field.
This first version therefore conservatively omits the **entire text** of a note
containing URL/link/image/Drive-embed/reference-link/HTML markers, while retaining
its authorized metadata:

```json
{
  "text": "",
  "textOmitted": true,
  "omissionReason": "linked_or_embedded_content"
}
```

This can omit otherwise native text, including ordinary text that resembles markup.
It is an explicit coverage restriction, not a Markdown renderer or a claim to
classify copied sensitive/provider-derived text. Adult selection/privacy review
still matters. Attachments, files, embeds, Calendar, School, Health, expenses and
administrative records are not queried. No link is followed, including instructions
inside a selected note. Gemini's existing receipts remain synthetic; the updated
WHO-478 approved-client policy allows a reviewed native-data pilot with explicit
provider-risk disclosure and fresh consent. No live household acceptance is implied.

## Bounds and continuation

Default list size is 25, maximum 50. Queries fetch at most `limit + 1` rows, and
response packing can return fewer rows to fit the complete serialized result.
An omitted tail always gets `truncated=true` and a continuation cursor. An empty
complete list has a null cursor. Per-record flags separately report shortened
fields; they do not imply that another page contains the removed field text.

Native note chunks contain at most 6,000 Unicode code points. PostgreSQL reads
at most 6,001 code points, rather than loading the whole text into the API. UTF-8
and JSON escaping can require a smaller chunk to fit the 32 KiB gateway response;
continuation offsets count Unicode code points so emoji/surrogate pairs are never
split, skipped or duplicated. SQL checks the whole text for excluded references
and computes its revision digest under the gateway's short statement timeout.

Cursors are HMAC signed with a purpose-derived `SESSION_SECRET` key and bound to
the immutable connection, tool and query filters (and note ID for text). They expire
after one hour. Changing page size is allowed; changing the tool/filter/grant or
tampering is rejected. A note content revision change invalidates an existing text
cursor; restart that note with a fresh request. Every continuation rechecks scopes,
grant/member/role, module entitlement, selection and ACLs. Cursor possession grants
no additional access. Secret rotation invalidates outstanding cursors. In every
environment, encoding or decoding a cursor without `SESSION_SECRET` fails closed
with temporary unavailability; there is no development signing-key fallback.
Initialization remains lazy so a disabled gateway can start without this key.

Gateway deadlines, concurrency/rate admission, metadata-only activity and retention
remain unchanged. Protocol responses include both text and structured content;
packing measures that duplication and JSON escaping while reserving protocol
overhead. Caller-selected oversized RPC IDs can still trigger the gateway's final
whole-response bound. No returned text, raw arguments or cursors enter audit logs.

## Verification and rollout

Run the explicit disposable PostgreSQL/HTTPS matrix:

```powershell
pwsh -NoProfile -File scripts/test-mcp-auth.ps1
```

It includes WHO-469–471 authorization/gateway regressions plus WHO-472:

- Official modern SDK calls for all four domain tools, with before/after snapshots
  of 13 domain/notification/outbox tables and zero queue/notification delivery calls.
- Unmaterialized recurrence and persisted overdue/reminder state remain unchanged.
- Two-household isolation, private/shared/selected-note filtering, removed shares
  and selections, wrong/missing/deleted IDs, scope and canceled-hosted entitlement
  checks, strict identity-free input and cursor tamper/query/grant/expiry tests.
- Byte-aware list pagination, Unicode/escaped note reconstruction, content revision
  invalidation and explicit link/embed/HTML omission without external fetching.

These are synthetic loopback TLS fixtures using real NOBYPASSRLS app/provider roles
in both single and shared deployment modes. They do not establish live household,
public edge, provider-account compatibility or production capacity. WHO-473 adds
the [broader adversarial authorization matrix](MCP_SECURITY_ACCEPTANCE.md);
client/privacy acceptance, skill
behavior, self-host dogfood and the separate hosted pilot remain later milestones.
Keep `MCP_ENABLED=false` on deployed installations until those gates pass.

Local verification on 2026-10-22: all 109 explicit PostgreSQL/HTTPS/cursor tests
passed; the regular suite passed 1,497 tests with 916 environment-dependent tests
skipped. All 17 repository typecheck tasks passed. The owned disposable PostgreSQL
container and ephemeral TLS key/certificate files were removed after the run.
