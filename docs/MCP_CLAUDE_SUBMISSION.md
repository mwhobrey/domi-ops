# Claude connector submission preparation (WHO-478)

The directory package is prepared locally. It is **not submitted or approved**.
The new registration-free onboarding still needs actual Claude acceptance on the
reviewed, deployed build. Earlier live synthetic checks used a manual public
client and cannot establish that new path. No household record belongs in a
public package or reviewer credentials.

## Selected approach

Use Claude's published identity (CIMD) for hosted and independently operated
self-hosted deployments. Do not require customers to register clients, extract
sessions or share a client secret. DCR remains disabled. See [setup](MCP_CLAUDE.md).

Start the hosted listing with the stable canonical hosted `/api/mcp` URL and
OAuth always required. Directory approval does not bypass household/member
consent or change privacy terms. Submit the briefing plugin separately and pair
it with the connector from the same long-term publishing organization.

Self-host users get an instance-specific Connect Claude link in AI connections.
A directory URL-pattern listing has additional Verified-review requirements;
acceptance of a pattern covering unrelated self-host domains is unconfirmed.
The supported custom-install link does not depend on that approval. Do not
publish WHome as the general hosted endpoint or introduce a Cloud auth broker.

## Generate reviewable materials

From the repository root:

```powershell
mise exec -- node scripts/mcp-claude/prepare-submission.mjs https://app.domi-ops.com .qa/claude-submission/NEW-DRAFT
claude plugin validate .qa/claude-submission/NEW-DRAFT/plugin
```

The exclusive output directory contains `listing.draft.json`, the existing
512-pixel product icon, this guide and the generated briefing plugin with its
MIT license. It contains no credential. `readyToSubmit` intentionally stays false
until the remaining receipts below exist. Generation does not contact Claude,
the deployment, or the directory. Do not change the flag merely to pass review.

Draft public fields include the product name/description, first-party data use,
read-only scope, docs/privacy/support URLs and CIMD without a secret. Confirm
the permanent slug, review contact, category choices and publishing account in
the portal; the first submission establishes listing ownership.

## Remaining launch receipts

- Merge/release the reviewed source and authorize the exact stable target update.
  Hosted customers must not use an unreviewed or disabled deployment. Preserve
  secrets, restricted app role, tenant isolation and migrations during rollout.
- Enable `MCP_ENABLED` and `MCP_CLAUDE_ENABLED` on that target. Check both resource
  documents and issuer discovery, exact scopes, public-client `none`, S256,
  CIMD advertisement, POST401/challenge and GET405. Confirm the target can fetch
  Claude's canonical metadata URL with valid TLS. A bot challenge/error is a
  release blocker, never a reason to copy browser cookies or weaken TLS.
- Publish the updated setup and assistant-sharing privacy disclosure. Verify
  those exact public URLs, icon and support destination before filling the portal.
- Create a populated fictional reviewer account in an isolated approved review
  deployment/household. Enter credentials only in the portal's private test-account
  fields after explicit upload approval. Never submit a real member's credentials,
  session, household content, service keys or database access.
- Record actual Claude connection without client-ID entry, discovery, every
  exposed read tool, refresh/reconnect and disconnect on the submission build.
  Use fictional records for directory evidence. Confirm all tools have titles,
  read-only hints, bounded input/output and useful failure messages. A local
  fixture proves server behavior, not Claude's current UI or directory acceptance.
- Verify the new settings card on desktop and mobile widths, enabled/disabled
  households, hosted and self-hosted origins. A live household check still needs
  the member's personal consent; it is not a requirement to expose real records
  to directory reviewers.

## Portal handoff

Open [Anthropic's developer portal](https://claude.ai/directory/manage) from the
account that should own the listing. Prepare the connector, then the plugin.
Use the draft for connection, listing, use cases and first-party data handling;
review every field against the actual deployed endpoint. Keep credentials out
of descriptions and screenshots. Directory terms and final Submit are owner
actions requiring approval at that time. No review duration or Verified label
is promised. This checklist grants no deployment/publication authorization.

## Official references checked 2026-10-23

- [Publishing and eligibility](https://claude.com/docs/directory/publish)
- [Connector submission](https://claude.com/docs/connectors/building/submission)
- [Review criteria](https://claude.com/docs/connectors/building/review-criteria)
- [Authentication and per-customer URLs](https://claude.com/docs/connectors/building/authentication)
- [Directory/custom connectors and install links](https://claude.com/docs/connectors/building/directory-vs-custom)
