# OpenAI plugin submission preparation (WHO-478)

Materials are local drafts, not uploaded, submitted, approved or deployed.
The approved self-host pilot verified published-identity connection and actual
reads; the installed Work briefing response hit model capacity. Hosted reviewer
acceptance and completion of the pilot remain release gates. Earlier WHO-475
manual-registration synthetic acceptance is separate evidence.

## Reproducible draft

```powershell
mise exec -- node scripts/mcp-chatgpt/prepare-submission.mjs https://app.domi-ops.com .qa/NEW-OPENAI-DRAFT
```

The exclusive directory contains `listing.draft.json`, this guide and `plugin/`,
plus unrun `review-plan.draft.json`, `recording-outline.md` and
`release-notes.draft.md`. The [shared review guide](MCP_SUBMISSION_REVIEW.md)
describes fictional fixtures and recording execution.
The portable plugin contains root `plugin.json`, `mcp.json`, README, icon and the
shared skill/MIT license. Its OAuth client declares `mode: cimd` without a client
ID or secret, with shopping/chores/refresh by default. Refresh is also a base
scope so tool-specific scope selection cannot drop it. The generator performs no
network request. `readyToSubmit` stays false until actual launch receipts exist.
Listing descriptions, package metadata and README follow the selected read scopes;
the default package makes no selected-note claim. The shared skill remains portable.

After reviewing the source and endpoint, ZIP the **contents** of `plugin/` so
`plugin.json` is at the archive root. Never ZIP the parent `.qa` directory,
infrastructure state, cookies, signing keys, reviewer credentials or household
records. Review the archive before any upload. See the
[official package reference](https://developers.openai.com/plugins/build/plugins).

## Deployment and paired acceptance

- Merge/release reviewed source and authorize the exact stable target update.
  Enable MCP/ChatGPT and optionally Claude with independent flags. Preserve the
  restricted database role, credentials, scopes, entitlement and consent gates.
- Check issuer/resource consistency, RFC9207 success and error redirects, S256,
  CIMD, the exact ChatGPT metadata/JWKS reachability, and no DCR. A metadata or
  signing failure is a release blocker; do not switch to anonymous access,
  accept arbitrary key URLs or rewrite the published identity to bypass it.
- Test both assistants using the same permitted shopping/chore questions,
  source links, empty/unsupported results, refresh/reconnect and disconnect.
  Each member personally approves provider-specific privacy/settings disclosures.
  Grant revocation in one assistant must not revoke the other. Do not infer real
  household usefulness or hosted behavior from local fixtures.
- Hosted listing uses a stable hosted endpoint and isolated populated fictional
  reviewer account. Never list WHome as the shared customer endpoint. Self-hosters
  use their own origin/package and local permissions; a public listing does not
  automatically provide arbitrary self-host endpoint selection.

## Submission handoff

Confirm the long-term publisher organization/project and verified identity first.
The [OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission)
describes ZIP upload, domain verification, server scan, review details and final
submission. Keep the proposed listing/category, public product/support/privacy/
terms URLs and icon accurate for the actual deployed build. Validate the package
and fix dashboard findings; generating a local draft proves none of those gates.

Before initial MCP review, prepare and verify all required review materials:

- Exactly five positive test cases, each with a scenario, user prompt, expected
  tools and observable result. Run each using the fictional reviewer account.
- Exactly three negative test cases, each with a prompt or scenario, why the
  plugin should not act, and the expected refusal, clarification or safe fallback.
  Run them with the same account and verify that behavior.
- A video walkthrough demonstrating the test cases and plugin functionality,
  available at a reviewer-accessible recording URL. Use fictional data only.
- Release notes identifying the submitted package version and its changes.

The generator leaves these materials pending; it does not invent passing cases
or a recording. Add the verified cases to `extensions.com.openai.review.test_cases`
in `plugin.json`, the recording URL to `review.demo_recording_url`, and release
notes to `extensions.com.openai.publication.release_notes` before packaging.
Check the imported materials in the portal's Review details before submission.

Prepare fictional review credentials privately and supply them only in the
portal's review-details fields after approval. Domain challenges must use the
exact portal value on an approved target without replacing another app's token.
Authorize upload/scan and final terms/submission at their applicable action time;
this guide is not that authorization. No waiting period, approval or availability
on every plan/device is promised.

## Official references checked 2026-10-24

- [Authentication and stable identity](https://developers.openai.com/plugins/build/auth)
- [Package format and CIMD mode](https://developers.openai.com/plugins/build/plugins)
- [Custom connection and testing](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Submission and domain review](https://developers.openai.com/plugins/deploy/submission) (review materials rechecked 2026-10-25)
