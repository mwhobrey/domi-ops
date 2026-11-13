# Grok Bot marketplace preparation (WHO-489)

## Update 0.2.0: assistant actions (prepared 2026-11-12, not submitted)

Grok Bot's update requests the same set as Claude's and ChatGPT's: shopping add,
medication groups and calendar availability. Selected notes stay out.

- Generate with a third argument:
  `node scripts/mcp-grok-bot/package.mjs https://app.domi-ops.com NEW_DIRECTORY shopping:read,chores:read,shopping:write,health:read,health:write,calendar:read`.
  Without it the package is the read-only one, now numbered 0.2.0.
- The suggested description below says the integration cannot save changes. For this
  update use: "Read shared household shopping lists and chores in Grok Bot, with links
  back to Domi Ops. Once you switch each on in Domi Ops, it can also add a shopping
  item, see the times and logging status of medication groups you choose and record one
  as taken, and see when you are busy on calendars you choose. It never receives
  medication names or event details, and it cannot edit, remove, skip or undo anything.
  School, Drive and planning notes are outside its permissions."
- Declare writes and health data in the form, as for the other two providers.
- Not yet observed with the real Grok Bot client: the medication and calendar tools,
  and any confirmation it shows before a tool that is not read-only.
- Tests and acceptance are in [the acceptance guide](MCP_ASSISTANT_ACTIONS_ACCEPTANCE.md).

Status: preparation only, not submitted. [PR #335](https://github.com/mwhobrey/domi-ops/pull/335)
contains the default-disabled integration. The successful fictional desktop
connection does not establish readiness on the permanent hosted reviewer endpoint.

## Submission route

The [official form](https://x.ai/bot/marketplace/submit-a-plugin), checked 2026-10-28,
accepts either a remote MCP server URL or public repository. Prepare the **MCP
server** route first, selecting **Grok Bot only**. The installed remote connection
has been exercised; combined catalog activation has not. Do not select Cursor or
ordinary Grok based on the shared OAuth identity. Grok is marked coming soon.

The hosted listing connects to `https://app.domi-ops.com/api/mcp`. Self-hosters
connect their own public HTTPS endpoint using [the setup guide](MCP_GROK_BOT.md)
and generate the same briefing package for that origin. A fixed hosted listing
does not automatically route to a self-hosted server. Do not introduce a broker.

A combined plugin submission needs a discoverable committed manifest, skill,
license, icon and MCP configuration. The generator alone at the repository root
does not satisfy that structure. Review a plugin directory/marketplace manifest
before offering a repository-based combined listing; do not submit a temporary
test URL or the whole source repo as though it were already an installable bundle.

## Prepared public fields

| Field | Draft |
| --- | --- |
| Publisher | Michael Whobrey / MikeWhob |
| Work email | me@mikewhob.com |
| Organization | MikeWhob |
| Suggested organization handle | mikewhob; availability not yet verified |
| Website | https://domi-ops.com |
| Target | Grok Bot |
| Server | https://app.domi-ops.com/api/mcp |
| Name | Domi Ops |
| Logo after marketing deployment | https://domi-ops.com/integrations/grok-bot-logo.svg |

Suggested description:

Read shared household shopping lists and chores in Grok Bot, with links back to
Domi Ops. Each eligible adult signs in and approves their own connection. This
integration reads existing records and cannot save changes. Calendar, School,
Health, Drive and planning notes are outside its permissions. Included in hosted
plans and free for self-hosting; a separate eligible assistant account is required.

The form requests a square SVG/PNG with a background plate. The prepared
`apps/www/public/integrations/grok-bot-logo.svg` retains the existing brand on a
dark plate. Its local rendering was inspected; its public URL still needs a
reviewed marketing deployment and verification before filling that field.

## Reviewer access and checks

After merge and an approved hosted rollout, verify the canonical HTTPS endpoint,
exact public client metadata/callback, S256 PKCE and shopping/chores/refresh scopes.
Use the existing isolated fictional reviewer household, never WHome or customer
records. Confirm its data, subscription entitlement and fresh sign-in still work.
Supply credentials only through an appropriate private review channel after owner
approval; the public testing-instructions field must not contain them.

Run the shared engineering cases: context, shopping, dated/undated open chores,
briefing with source links, bounded pagination, filtered empty results and truthful
refusal of writes, excluded domains and identity changes. Include refresh, scope
reduction, fresh consent and disconnect denial. Compare domain/notification/queue
snapshots around assistant reads; record expected setup mutations separately.
The reused five-positive/three-negative plan is our engineering checklist, not a
claim that Grok mandates OpenAI's review format or case count.

Private skill editor normalization and combined plugin activation require their
own proof. Record application version, platform and actual account eligibility.
Keep execution receipts separate from case definitions; unavailable/blocked cases
remain incomplete. Do not label missing tools as server-rejected calls.

Record a short fictional walkthrough if useful to reviewers: sign-in/consent,
briefing/sources, refusal, refresh and revocation. No new recording or public video
URL is claimed by this document.

## Final gates

- PR review/CI and merge; explicit hosted deployment approval and verified rollout.
- Complete stable-endpoint reviewer acceptance and the compliant public logo URL.
- Review public copy, contact/handle and private reviewer-access mechanism.
- Personally authorize the final form's testing attestation, publisher terms and
  submission when the concrete draft is ready. No terms or submission is authorized
  by preparation alone.

[Integration contract](MCP_GROK_BOT.md) ·
[Cursor plugin structure](https://cursor.com/docs/reference/plugins) ·
[Privacy](https://domi-ops.com/privacy) ·
[Support](https://github.com/mwhobrey/domi-ops/issues/new/choose)
