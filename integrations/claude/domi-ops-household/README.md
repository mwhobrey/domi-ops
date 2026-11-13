# Domi Ops household

Read persisted shared household chores and shopping items. Where the server's
operator offers it and you switch it on, Claude can also add a shopping item,
tell you when a medication group you shared is due, record that group as taken
when you say you took it, and tell you when you are busy on calendars you chose.
Ask for a household briefing, or say "add oat milk to the shopping list".

Two skills are included. The household briefing skill explains how to retrieve
bounded results, report missing coverage and link back to your records. The
household actions skill explains the few things Claude can do and how to report
them exactly.

## Install and connect

This package connects only to https://app.domi-ops.com/api/mcp. Install it through
Claude's supported plugin flow, then sign in to that Domi Ops server and review
the exact member, household and permissions before approving access. The
operator and household administrator must enable AI connections first. Do not
enter an API key, client secret or request header. A separate Claude account is
required. Standard integration is included in hosted pricing and free for
self-hosting; self-hosters generate a package for their own public HTTPS origin.

## What Claude can do, and who decides

Three things must all allow an ability: the server's operator offers it, you
approve it when you sign in, and you switch it on for this connection in
Domi Ops under Settings, AI Connections. Reading shopping and chores starts on
and can be unticked. Every other ability starts off. You can switch any of them
off again at any time, and it takes effect on Claude's next request.

Actions finish in chat: there is no second confirmation step in Domi Ops, though
Claude may ask you to confirm. They are limited to adding a shopping item and
recording a medication group as taken. Claude cannot edit, check off, remove,
skip, undo or delete anything, and cannot create calendar events. Domi Ops keeps
a list of what each assistant did, visible only to you.

## Permissions and privacy

The plugin declares one remote HTTPS MCP connector and two skills. It runs no
local commands, hooks or background programs. Approved reads send household labels/timezone and chores and shopping items to Claude. Adding a shopping item sends back the item you asked for; it cannot edit, check off or remove one. Medication group access sends a label you choose, the group's times and whether it was logged. Medication name, strength, instruction and history fields are never sent, but the label is sent as you wrote it, so choose one that does not name a medication. Timing and logging status are still personal health information. Recording a group as taken only fills gaps for medications you approved; it cannot skip, undo or change an entry, and Domi Ops notifies you each time. Calendar availability sends merged busy times for calendars you choose. Event titles, locations, people and calendar names are never sent, and events imported from Google Calendar are left out.
There is no planning-note, School, Drive or attachment access in this package.
Do not share copied Google-derived, health, child or excluded content.
Review Claude's privacy settings and terms before consenting. Disconnect in
Domi Ops AI Connections to stop future access; this cannot erase provider copies.

## Troubleshooting and support

If connection fails, confirm the server URL, HTTPS reachability and AI connection
settings, then check the permissions shown during sign-in. If Claude says an
ability is switched off, turn it on in Domi Ops AI Connections; if it is not
offered there, the server's operator has not enabled it. Stop on unexpected
permissions; do not share login sessions or disable authentication.
See [setup](https://github.com/mwhobrey/domi-ops/blob/main/docs/MCP_CLAUDE.md),
[privacy](https://domi-ops.com/privacy) and
[support](https://github.com/mwhobrey/domi-ops/issues/new/choose).
This MIT-licensed package does not establish directory approval or live service
availability by itself.
