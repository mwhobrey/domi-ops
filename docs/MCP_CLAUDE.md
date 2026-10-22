# Claude private evaluation (WHO-476)

This integration uses the shared Domi Ops MCP endpoint and portable household
briefing skill. Hosted access is included in the base price; self-hosted access
remains free. No deployment, production enablement or directory listing is implied.

## Connection contract

- Use the deployment's canonical public HTTPS origin and `/api/mcp`, with
  Streamable HTTP and OAuth sign-in required. Claude's remote connectors run from
  Anthropic's cloud, including when used from desktop or mobile. A LAN-only URL
  or the private OpenAI Secure MCP Tunnel cannot serve this connection.
- Register a separate approved public client with exact redirect
  `https://claude.ai/api/mcp/auth_callback`, PKCE S256, token authentication `none`,
  and `shopping:read chores:read notes:read offline_access`. In Claude choose
  **Use your own OAuth client**, enter that client ID, and leave the secret and
  request headers empty. Domi Ops does not enable DCR or CIMD for this pilot.
- Each adult signs in to Domi Ops and grants access for their own household,
  explicitly selecting any notes. App installation, OAuth registration, household
  enablement and member consent are separate operations. Calendar, School,
  Health, Drive and writes remain outside this workflow.
- Hosted and self-hosted use the same authorization and read boundaries. Hosted
  packaging does not bypass module entitlements. Self-host operators supply a
  reachable HTTPS origin and compatible reverse proxy; never expose a household
  merely to evaluate this package.

## Separate synthetic lab

Use a fresh worktree so its owned Compose project, ports, data and credentials
cannot overlap another lab. Start a temporary HTTPS tunnel to the app port only;
the tunnel must preserve the public Host. Obtain its origin before building:

```powershell
$env:DOMI_QA_BASE_PORT = '18180'
$env:DOMI_QA_MCP_ORIGIN = 'https://YOUR-TEST-HOST'
node scripts/hosted-qa/run.mjs mcp
```

The canonical origin is retained in ignored owned state and cannot be changed on
an existing lab. If a temporary URL changes, use a fresh lab. Public mode refuses
real-provider and ordinary browser-test modes. Its generated fixture password
is available only through the local fixture guide; public signup stays disabled.
Only the API gets outbound networking for canonical HTTPS JWKS verification;
database, storage, workers and provider simulators retain the internal QA network.
TLS verification, issuer, resource and audience validation remain enabled.

With this checkout's project name and ignored env file, run the QA tools entry:

```powershell
docker compose --project-name YOUR-OWNED-PROJECT --file docker-compose.qa.yml --env-file .qa/hosted/compose.env run --rm tools node scripts/mcp-claude/register-client.mjs
node scripts/mcp-chatgpt/smoke.mjs
```

Registration is idempotent and synthetic-only. It creates a distinct Claude
profile, prints a public client ID, and retains its metadata in the QA volume.
The shared smoke verifies real OAuth, five reads, refresh and disconnect using a
separate local inspector client; it is **preflight**, not Claude acceptance.
Never copy QA credentials or grants to a real deployment. Stop the owned temporary
tunnel when live testing finishes; `node scripts/hosted-qa/run.mjs down` stops only
this checkout's stack, while `reset` additionally removes its five owned volumes.

## Portable skill and Claude package

```powershell
node scripts/mcp-claude/package.mjs https://YOUR-TEST-HOST .qa/claude/NEW-PACKAGE
claude plugin validate .qa/claude/NEW-PACKAGE
```

The generator writes `.claude-plugin/plugin.json`, `.mcp.json` and the shared
`skills/domi-ops-household-briefing/{SKILL.md,LICENSE.txt}` byte-for-byte. It refuses
existing output directories and accepts no secrets. Archive the directory with
dotfiles included. Private upload under Customize → Plugins is separate from
connecting the OAuth client; inspect the plugin's Connectors tab before testing.
Standalone Skills upload is an alternative surface, with Claude's required code
execution/file creation setting. Do not assume plugin or skill installation
proves tool connectivity, or that a web receipt proves Code/mobile behavior.

## Acceptance status

2026-10-22: the separate public HTTPS synthetic lab passed the shared modern MCP
preflight, including real PKCE/selected-note consent, all five approved reads,
refresh rotation and disconnect invalidation. Package preservation/negative-origin
checks pass. The installed Claude Code CLI validates the generated manifest.
Claude Pro web exposed custom connectors, Skills and Plugins; remote discovery
selected Streamable HTTP and the pre-registered public-client option successfully.
Actual Claude reads passed for connection context, chores, shopping, selected-note
listing and selected-note content, with per-call approval, exact app links and
explicit excluded-domain/no-write coverage. The provider recorded normal Claude
refresh rotation without artificially expiring or copying credentials. The current
modern gateway served the connection without adding legacy compatibility.
Removing `chores:read` through Domi Ops prevented the next live Claude chore read:
Claude showed Reconnect, then a generic connector error, with no admitted tool
reads after reduction. Fresh explicit consent replaced the old grant, revoked its
refresh credentials, and restored connected tool discovery. Claude's error did
not identify the missing scope; do not claim a user-visible diagnostic it did not
provide. Private combined-plugin upload/installation passed, showing one skill
and one connected synthetic connector. Its installed skill completed a fresh
five-read briefing after reauthorization: correct household-local date and chore
groups, unchecked shopping, selected note text, exact returned app links,
persisted-only coverage, excluded Calendar/School/Health and no saved changes.
Matching application audit events confirm five successful reads, within the
skill's twelve-call budget. Product Disconnect then revoked the replacement grant
and all Claude refresh credentials. While the HTTPS service still returned 200
discovery, the next approved fresh Claude context read showed Reconnect and
produced zero successful reads after revocation. It was not reconnected.

The final QA image rebuilt successfully and passed the full shared preflight
after API readiness. Seventeen QA/packaging checks and repository lint passed
(zero errors; 216 existing warnings). After live acceptance, the owned temporary
tunnel and this lab's containers were stopped; named volumes and ignored local
receipts were retained. Both pre-existing QA labs remained healthy. The private
Claude plugin remains installed, pointing to the now-stopped synthetic endpoint;
its old result links are test receipts, not durable deployment links.

Natural grant expiry, mobile, Code,
real households, hosted production and public directory listing are unverified.

## Sources checked 2026-10-22

- [Claude remote custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Connector authentication and callbacks](https://claude.com/docs/connectors/building/authentication)
- [Testing local servers through public HTTPS](https://claude.com/docs/connectors/building/testing)
- [Claude plugin layout and validation](https://claude.com/docs/plugins/build)
- [Skills installation](https://support.claude.com/en/articles/12512180-use-skills-in-claude)
- [Cloudflare temporary tunnels and limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
