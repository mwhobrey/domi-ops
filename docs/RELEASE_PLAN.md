# Release cut: v0.13.0

Updated November 13, 2026. Minor release after v0.12.0, carrying the assistant
actions work (#353, #354) and the public ChatGPT listing link (#352). Use
[RELEASE_PROCESS.md](./RELEASE_PROCESS.md) for the release procedure.

## Scope

- Assistant connections gain per-connection capabilities, a consent preview of
  the exact data shared, and three optional abilities: adding a shopping item,
  medication group times with recording a group as taken, and calendar
  availability as merged busy blocks (#353, migrations 0108 to 0110).
- Provider packages 0.2.0 for Claude, ChatGPT and Grok Bot with a household
  actions skill, review plans and submission guides (#353, #354). Nothing is
  submitted to a store by this release.
- Privacy policy: the assistant section describes the new abilities and what a
  medication group label shares; "What Health stores" names every entry type.
- README and marketing site link the public ChatGPT listing (#352).

## What this release does not switch on

Every new ability is off until an operator lists it. A deployment that keeps
its current environment behaves as before, apart from the changes below:
`MCP_DIRECT_ACTIONS_ENABLED` defaults to false, and `health:read` and
`calendar:read` are offered only when named in `MCP_READ_SCOPES`. Hosted
production keeps its existing ceiling until the owner changes it; that change,
each provider's acceptance run and each store submission are separate steps
in [the acceptance guide](./MCP_ASSISTANT_ACTIONS_ACCEPTANCE.md).

Changes that apply without any flag:

- Existing assistant connections keep exactly the reads they had. Tools now
  also require a capability row, which migration 0108 backfills.
- The consent screen and AI connections settings show the capability choices.
- The published privacy policy text changes.

## Upgrade requirements

Upgrades from v0.12.0 require migrations `0108_mcp_capabilities`,
`0109_mcp_med_group_selections` and `0110_mcp_calendar_availability`, and a
re-grant of the restricted app role. The documented deployment scripts pause
API and worker before DDL, apply migrations with the admin connection, verify
grants, then start the new images. Hosted CI deploy uses
`deploy-hosted.sh --migrate`. Failed migration or grant checks leave those
services stopped for recovery; fix forward before restarting. See
`deploy/HOSTED_OPS.md`.

No consent policy change: existing assistant connections do not need to
reconnect. A member reconnects only to be offered the new abilities, once an
operator offers them.

## Check after the hosted deploy

Migration 0108 gives each existing connection the reads it already holds.
Compare the two results below; each read scope's count must equal its
capability's count (`shopping:read` to `shopping.read`, and so on):

```sql
select s as scope, count(*) from mcp_connections c, unnest(c.scopes) s
where c.status <> 'revoked' and s in ('shopping:read','chores:read','notes:read') group by s;

select capability, count(*) from mcp_connection_capabilities
where consent_version = 'backfill.0108' group by capability;
```

Correction, November 13, 2026: an earlier version of this section gave an
expected count of two rows for hosted. That figure came from a read-only check
run against a self-hosted instance by mistake, not against hosted production,
so it says nothing about hosted. The hosted deploy job for v0.13.0 reported
all 111 migrations applied and the app role re-granted; the row comparison
above has not been run on the hosted database.

If the counts do not match, existing
connections have lost their reads; re-run the `INSERT` statement from
`0108_mcp_capabilities.sql` as the table owner, which is safe to repeat. The
full check is in part 1 of the acceptance guide.

## Release gates

1. Verify CI and image publishing on the main commit that holds #353 and
   #354. Reconcile newer main changes before choosing the release candidate.
2. This release PR updates root package and lockfile version metadata to
   0.13.0, dates the Unreleased changelog and sets the legal pages' "last
   updated" date, without changing dependencies.
3. Obtain clean release-PR CI and review, merge, then verify workflows for
   that exact main SHA before tagging.
4. Recheck remote v0.13.0 tags and GitHub Releases. Create the tag once at
   the verified release commit; never replace an existing tag.
5. Follow the tag-triggered Publish images workflow through all five images
   and hosted deployment. Verify image revision receipts, the backfill check
   above, and public API, login and marketing HTTP responses before
   publishing the GitHub Release.

Self-host deployments remain operator-run. This release procedure publishes
the images and uses the repository's hosted deployment workflow.
