# Release cut: v0.12.0

Updated November 8, 2026. Minor release after v0.11.3, including Health supply
in pills (#347), organizer skip/keep-out (#346), medication intervals up to
365 days (#341), and the MCP stack that shipped on main after v0.11.3. Use
[RELEASE_PROCESS.md](./RELEASE_PROCESS.md) for the release procedure.

## Scope

- Health: supply in pills (#347, migration 0107), organizer skip/keep-out
  (#346, migration 0106), medication intervals up to 365 days (#341).
- MCP stack since v0.11.3: authorization/consent/gateway, read-only
  shopping/chores/notes tools, ChatGPT/Claude/Grok onboarding, reviewed-write
  foundation (disabled; no production write actions), consent policy v3
  (existing assistant connections need to reconnect; ordinary sessions and
  Google grants preserved), robots.txt for app.domi-ops.com, hosted pool
  defaults, www redirects, child assignee name withholding.

## Upgrade requirements

Upgrades from v0.11.3 require migrations `0103_mcp_authorization` through
`0107_health_supply_pills` and a re-grant of the restricted app role. The
documented deployment scripts pause API and worker before DDL, apply
migrations with the admin connection, verify grants, then start the new
images. Hosted CI deploy uses `deploy-hosted.sh --migrate`. Failed
migration/grant checks leave those services stopped for recovery; fix
forward before restarting. See `deploy/HOSTED_OPS.md`.

Consent policy v3 requires existing assistant connections to reconnect after
upgrade; ordinary sessions and Google grants are preserved.

## Release gates

1. Obtain clean PR CI and CodeRabbit review; address or resolve every
   actionable thread before merging.
2. Verify CI and image publishing on the resulting main commit. Reconcile
   newer main changes before choosing the release candidate.
3. Prepare a separate release PR updating root package/lockfile version
   metadata to 0.12.0 and dating the Unreleased changelog without changing
   dependencies.
4. Obtain clean release-PR CI and review, merge, then verify workflows for
   that exact main SHA before tagging.
5. Recheck remote v0.12.0 tags and GitHub Releases. Create the tag once at
   the verified release commit; never replace an existing tag.
6. Follow the tag-triggered Publish images workflow through all five images
   and hosted deployment. Verify image revision receipts and public API,
   login and marketing HTTP responses before publishing the GitHub Release.

Self-host deployments remain operator-run. This release procedure publishes
the images and uses the repository's hosted deployment workflow.
