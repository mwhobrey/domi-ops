# Assistant submission review materials (WHO-478)

Prepare both providers from the same reviewed source and shared skill. Generated
materials are drafts; they do not upload, create an account, grant access or mark
acceptance as passed. Hosted inclusion and free self-hosting are unchanged.

## Generate current drafts

```powershell
mise exec -- node scripts/mcp-claude/prepare-submission.mjs https://app.domi-ops.com .qa/NEW-CLAUDE-SUBMISSION
mise exec -- node scripts/mcp-chatgpt/prepare-submission.mjs https://app.domi-ops.com .qa/NEW-OPENAI-SUBMISSION
```

Each exclusive output contains the package, provider guide, listing draft,
`review-plan.draft.json`, `recording-outline.md` and `release-notes.draft.md`.
The review plan has exactly five positive and three negative case definitions,
fixture requirements and empty execution/recording receipts. The generated
OpenAI cases follow its selected read scopes; Claude's initial review draft
assumes shopping/chores/refresh, with no notes. Match the actual deployment to
the draft. If the approved launch scope changes, revise and rerun the cases.

The five/three count is an OpenAI initial MCP review requirement. Reuse the cases
for Claude engineering checks, while following Claude's own portal requirements.
Case definitions describe expected behavior, not successful execution.

## Isolated fictional review account

On the separately approved stable hosted deployment, provision an isolated
fictional household and dedicated adult reviewer account through the supported
operator/account flow. Give it only the entitlement and data needed by the cases.
Reviewers must be able to sign in immediately, without a personal account,
private network, MFA approval, email/SMS code or a magic link. Verify this in a
fresh signed-out browser. Keep credentials in protected operator storage and the
portal's private reviewer fields, never in a package, source tree or recording.

Populate fixtures for enabled domains:

- Shopping: clearly fictional unchecked items with varied quantity/unit/aisle,
  plus checked items that the default read must exclude.
- Chores: fictional open and completed tasks; dates before/on/after the current
  household date, plus undated work. Include a task assigned to another fictional
  member to verify that these are shared household reads.
- Pagination: 61 matching accessible records for the plan's selected list.
  Reset fixtures between cases using the application/operator tools, never an
  assistant write. The two-page limit must produce a partial-coverage disclosure.
- Optional notes: if approved for launch, select native readable notes and keep
  separate unselected/private/foreign records. Do not use Google-derived, health,
  child or real household content.

Neither the real-household pilot nor a local fixture establishes hosted acceptance.
Run the plan in each actual provider on the final submission endpoint/build.
Record provider, surface, package/build version, UTC time, actual tools/results
and pass/fail privately. Preserve zero/incomplete/unavailable distinctions. A
model-capacity error is an uncompleted case, not an OAuth failure or a pass.

## Recording and package handoff

Use the generated outline to demonstrate fresh sign-in, exact scopes, the five
positive and three negative cases, source links, real refresh/reconnect and
disconnect denial. Show independent grants: revoking one assistant must not
revoke the other. Keep secrets and non-fictional content out of the recording.

After the fictional cases actually pass, add their definitions to OpenAI's
`extensions.com.openai.review.test_cases`, the real accessible recording URL to
`extensions.com.openai.review.demo_recording_url`, and reviewed version notes to
`extensions.com.openai.publication.release_notes`. The generator intentionally
does not fabricate these execution receipts or a video URL. Verify the imported
materials in the portal. Authorize upload/scans, domain verification and final
terms/submission at their applicable steps.

Claude requires a connector submission and a GitHub plugin-source submission
from the same long-term publishing organization. Its generated package includes
the square icon and explicit documentation/support/privacy/terms links. Prepare
the source folder through the release PR described in
[Claude submission](MCP_CLAUDE_SUBMISSION.md); validate the exact source commit in
the portal after merge. CLI validation alone is not directory approval.

For private ChatGPT **web** testing, a raw remote-MCP archive may import with
desktop-only use. Create/connect the instance's custom MCP server once, then use
the existing `--registered` package mode to bundle its actual `plugin_asdk_app_…`
ID with the skill. This app mapping is private test packaging: OpenAI's public
submission rejects `.app.json`/app references. The public draft must retain its
remote HTTPS `mcp.json` and published-identity OAuth configuration. Never map a
real household briefing to the old synthetic connector.

## Remaining public release gates

- Complete the bounded pilot and record its go/no-go; real provider refresh and
  revocation remain separate checks. Keep reviewed writes gated under WHO-479.
- Separately review/authorize hosted MCP deployment and enablement with the
  restricted role and exact canonical issuer/resource/scopes.
- Publish and verify the current assistant-sharing privacy disclosure and public
  product, support, terms and documentation pages. Do not infer this from source.
- Confirm permanent publisher ownership and OpenAI individual/business identity
  verification before starting portal submissions.
- Complete fictional reviewer access, actual provider cases/video and portal
  checks. Self-host directory URL selection remains provider-specific; preserve
  instance-specific setup independently of listing approval.

## Official sources checked 2026-10-26

- [OpenAI submission and review metadata](https://developers.openai.com/plugins/deploy/submission)
- [Claude plugin manifest fields](https://code.claude.com/docs/en/plugins-reference)
- [Claude plugin portal checks](https://claude.com/docs/plugins/pre-submission-checklist)
