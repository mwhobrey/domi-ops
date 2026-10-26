# Domi Ops household briefing

Read persisted shared household chores and shopping items.
Ask Claude for a household briefing or a shopping-and-chores
check-in. The shared briefing skill explains how to retrieve bounded results,
report missing coverage and link back to your records. It cannot save changes.

## Install and connect

This package connects only to https://app.domi-ops.com/api/mcp. Install it through
Claude's supported plugin flow, then sign in to that Domi Ops server and review
the exact member, household and permissions before approving access. The
operator and household administrator must enable AI connections first. Do not
enter an API key, client secret or request header. A separate Claude account is
required. Standard integration is included in hosted pricing and free for
self-hosting; self-hosters generate a package for their own public HTTPS origin.

## Permissions and privacy

The plugin declares one remote HTTPS MCP connector and the household briefing
skill. It runs no local commands, hooks or background programs. Approved reads
send household labels/timezone, chores and shopping items to Claude. This launch
scope has no planning-note, Calendar, School, Health, Drive or attachment access.
Do not share copied Google-derived, health, child or excluded content.
Review Claude's privacy settings and terms before consenting. Disconnect in
Domi Ops AI Connections to stop future reads; this cannot erase provider copies.

## Troubleshooting and support

If connection fails, confirm the server URL, HTTPS reachability and AI connection
settings, then check the permissions shown during sign-in. Stop on unexpected
permissions; do not share login sessions or disable authentication.
See [setup](https://github.com/mwhobrey/domi-ops/blob/main/docs/MCP_CLAUDE.md),
[privacy](https://domi-ops.com/privacy) and
[support](https://github.com/mwhobrey/domi-ops/issues/new/choose).
This MIT-licensed package does not establish directory approval or live service
availability by itself.
