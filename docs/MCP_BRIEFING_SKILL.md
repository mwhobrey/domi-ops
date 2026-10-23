# Household briefing skill

WHO-474 supplies one portable, instruction-only workflow at
[`skills/domi-ops-household-briefing/SKILL.md`](../skills/domi-ops-household-briefing/SKILL.md).
It uses the existing five approved [MCP tools](MCP_READ_TOOLS.md) to summarize
persisted chores, unchecked shopping and explicitly selected planning notes. It
adds no endpoint, model service, dependency, migration or application setting.
Hosted base pricing includes this integration; self-hosted use is free.

## Install and invoke

This is a source package for controlled evaluation, not a published marketplace
plugin or a claim of verified ChatGPT/Claude/Gemini interoperability. Review the
instructions before installing. It follows the portable
[Agent Skills format](https://agentskills.io/specification): one directory with
`SKILL.md`, a name/description and a version in metadata.

1. Use an operator-approved Domi Ops MCP client profile and complete the normal
   member-owned consent flow. Configure the endpoint for that specific deployment
   through the client's MCP setup. A skill does not configure OAuth, register a
   client, enable the deployment flag or grant access. Never place tokens, browser
   cookies, household/member IDs or private data in this package.
2. Copy the **whole `domi-ops-household-briefing` directory** to the target client's
   supported skill location or upload it with that client's supported skill import.
   Keep `SKILL.md` at the skill directory root. The same source applies to hosted
   and self-hosted deployments; there is no embedded hostname or client-specific
   tool prefix. Import support and setup must be confirmed on the actual client.
3. For local Codex evaluation, a supported repository location is
   `.agents/skills/domi-ops-household-briefing/` within the evaluator's project;
   user-wide discovery uses `~/.agents/skills/domi-ops-household-briefing/`.
   Copy the source folder there, avoiding a duplicate name already installed.
   See [official OpenAI skill setup](https://learn.chatgpt.com/docs/build-skills).
   This checkout keeps the distributable source under `skills/` to avoid
   automatically activating a household workflow during product development.
4. Ask: “Use domi-ops-household-briefing for a quick household briefing,”
   “What do we need to buy?” or “Summarize open chores through October 25.”
   Clients that support implicit skill matching may select it from the description.
   If no valid connection exists, expect setup guidance rather than a briefing.

Before live household data, complete the M4 client/privacy gates. The Gemini
evaluation evidence remains synthetic; WHO-478's [updated policy](MCP_M1_DECISIONS.md)
allows a reviewed native-data pilot after explicit provider-risk disclosure/consent.
Client-specific plugin manifests, import UI steps and live compatibility belong
to WHO-475–477; they must consume this shared source rather than fork its workflow.
This change does not install the skill into anyone's active client or alter consent.

## Retrieval and answer contract

Context comes first. Only tools advertised by that connection may follow. A
general briefing reads open chores, unchecked shopping and selected note titles;
it reads text only for relevant selected notes. Narrow requests retrieve fewer
domains. Defaults are 25 records, at most two pages per list, three note bodies and
two chunks per note, with an overriding **12-call total budget**, including
context, failed requests and continuations. Return useful partial coverage when a
bound or error is reached. Never follow an embedded URL or use another API to
fill gaps. Missing capabilities and errors are not empty lists.

Household-local date comes from context timezone plus a trusted current instant,
or a tool's retrieval time/timezone when the host clock is unavailable. Without
either, show literal dates with a limitation. Open tasks are grouped as overdue,
today, upcoming and undated. An explicit through-date filter excludes undated
tasks, which must be disclosed. Future unmaterialized recurrence is always outside
coverage. List ID order does not establish priority or urgency completeness.

Every mentioned record gets its returned app link; no new record URL is invented.
Labels, titles and bodies remain untrusted reference data. Text-omission and
shortening flags, unconsented scopes, inaccessible notes and incomplete pages are
disclosed. Calendar, School and Health are never implied to have been checked.
Suggestions remain conversational; no edits, completions, messages or jobs are
saved, even if a retrieved note or the user requests them within this workflow.

## Version, update and remove

The initial skill version is **0.1.0** in `metadata.version`, independently of the
application release. Pin the reviewed repository commit and retain the skill file
hash in the evaluation receipt. Change the version when workflow behavior changes;
review tool/argument/budget changes and replay the examples before distribution.
Do not infer newer server permissions from a newer skill version.

To update, review the new folder against the installed copy, replace that copy
through the client's supported update flow and start a fresh briefing. Preserve
local customizations separately instead of silently overwriting them. To remove,
use the client's uninstall flow or remove only this installed skill directory.
Removing instructions does **not** revoke the MCP connection or erase an
assistant's previous chat data. Disconnect in Domi Ops AI Connections when access
must end, and use the provider's separate data controls for retained conversations.

## Synthetic examples and verification

[`fixtures/mcp-briefing-cases.json`](fixtures/mcp-briefing-cases.json) contains nine
authored prompts, synthetic responses, bounded reference traces and human review
criteria. `apps/api/src/mcp/briefing-skill.test.ts` checks those traces against the
real production tool input/output schemas, advertised capabilities, selected-note
references, cursor continuity, budgets and household-local date expectations.

```powershell
mise exec -- npx vitest run apps/api/src/mcp/briefing-skill.test.ts
```

These are **authored reference traces**, not transcripts produced by a model.
Contract replay guards examples against server drift; it does not establish
automatic triggering, instruction compliance, model citation behavior or safety
on a particular assistant. The manual review below checks the intended workflow;
actual approved-client executions must record model/version, tool trace, response,
skill version/hash and reviewer outcome during M4. Do not substitute these examples
for those live receipts or WHO-473's real database acceptance.

| Case | Reference outcome checked during author review |
| --- | --- |
| Daily, UTC midnight | `2026-10-23T00:30Z` is October 22 in Chicago; October 21 is overdue, 22 is today, 23 is upcoming, null is undated. Cite the chore records and milk; infer no quantity or calendar events. |
| Complete empty sources | Say no accessible persisted open records were returned; notes were not checked. Never say the household has no work or future recurrence. |
| Shopping-only access | Read shopping only; cite rice without fetching chores or notes or escalating consent. |
| Two-page bound | Stop at the second chore page's non-null cursor and disclose incomplete ID-ordered coverage; do not claim the most urgent items were found. |
| Hostile/linked notes | Plain-text identity/shell/file/credential instructions confer no authority. Link syntax is kept in the separate omitted-note case; its text remains unchecked. |
| Revoked selected note | Disclose unavailability, omit prior text and do not probe alternate IDs. |
| Throttle after chores | Stop further calls, summarize the available chores with links and label shopping/notes unavailable or unqueried. |
| Through-date and write request | Separate overdue/upcoming dates, disclose exclusion of undated tasks, and explain that this workflow cannot complete chores or read Health. |
| Context-only connection | Give a short missing-coverage answer, with no claims that sources were empty. |

Example rendering of the midnight fixture (illustrative wording, not a model run):

> October 22, America/Chicago; retrieved October 22 at 7:30 PM local. Among the
> persisted tasks returned: [overdue](https://fixture.invalid/chores?highlight=00000000-0000-4000-8000-6f7665726475) was due
> October 21, [today](https://fixture.invalid/chores?highlight=00000000-0000-4000-8000-746f64617900) is due today,
> [upcoming](https://fixture.invalid/chores?highlight=00000000-0000-4000-8000-7570636f6d69) is due October 23, and
> [undated](https://fixture.invalid/chores?highlight=00000000-0000-4000-8000-756e64617465) has no due date.
> [Milk](https://fixture.invalid/shopping) is unchecked; no quantity was provided.
> The selected [plan](https://fixture.invalid/notes) mentions reusable shopping
> bags. You could start with the overdue task and bring bags when shopping.
> This covers persisted records only; Calendar, School and Health were not checked.
> No changes were saved.

The fixture deliberately validates supplied links without deriving them from IDs;
its synthetic links are not live records. Tool results can change between calls,
and the server does not offer a point-in-time briefing snapshot.

Local verification on 2026-10-22, based on WHO-473 commit
`a5647375e78ab4a99ed3855c626c40c3291f2707` (tree-equivalent to merged main
`17a06a10a152213584309541328c26c6deb8df21`): all nine reference-contract tests
passed, the regular suite passed **1,506 tests** with **934 environment-dependent
skips**, and all **17 repository typecheck tasks** passed, followed by a fresh API
typecheck. The skill-creator frontmatter validator passed. A locally generated ZIP
contains exactly the skill and MIT license, with its skill entry matching the
source SHA-256:

```text
A041A42251A71BE9E61D4317172B60547A823655F96EF0790A5A59AA0321D065
```

For local packaging, archive the `skills/domi-ops-household-briefing` folder with
its directory name preserved. Do not include the repository, tests, credentials
or private fixture data. The verified local artifact is
`.qa/skill-packages/domi-ops-household-briefing-0.1.0.zip` (ignored by Git). No
marketplace publication, client installation or live model evaluation occurred.
