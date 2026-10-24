# Operator client provisioning (WHO-478)

For new Claude connections, prefer [published-identity onboarding](MCP_CLAUDE.md).
It requires no operator session file or manual public-client registration. This
CLI remains available for other reviewed clients and earlier manual evaluations.

Local operator tool; no HTTP administration endpoint. The same procedure serves
self-host and hosted deployments using their own canonical URL, app DB role and
member session. This prepares a client profile, never household opt-in or member
consent. No deployment or real registration has been performed by this issue.

## Preconditions

- Approved exact target, provider/profile version, adult/privacy handling and
  callback; authorized deployment change and reviewed build. Follow
  [setup](MCP_SETUP.md) and the [pilot gates](MCP_PILOT.md).
- Target's existing protected environment with its canonical `PUBLIC_APP_URL`,
  `SESSION_SECRET`, `ENCRYPTION_KEY` and restricted application `DATABASE_URL`.
  The tool rejects SUPERUSER/BYPASSRLS sessions. Never substitute an admin DB URL.
- A current Domi Ops member's real sign-in session for that same target. This
  authenticates registration; the local process's operator access is the
  administrative authority. It does not consent for that member or other adults.
- A private operator directory writable by only the operator/container user.
  Keep config, session and receipts outside tracked source. Ignored `.qa/` is
  suitable locally only with appropriate permissions; it is not encrypted.
  Unix receipt creation requests mode 0600; Windows operators must restrict the
  folder's ACL. Do not copy a browser profile or use a household password/API key.

There is no new dependency or migration. For a source checkout, build the pinned
config/crypto/db/auth packages in dependency order using repository Node 22.
Released API images already carry the built auth workspace. Run the tool inside
the intended trusted environment, not against a browser-supplied server address.
For containers, use an operator-controlled private mounted directory and invoke
the tool explicitly; don't launch the API migration entrypoint for this task.

## Prepare and preview

Create `client.json` in that private directory. Example for the currently reviewed
Claude public-client shape (replace the target, name and version deliberately):

```json
{
  "origin": "https://domi.example.com",
  "provider": "claude",
  "name": "Private adult household pilot",
  "profileVersion": "pilot.claude.v1",
  "redirectUri": "https://claude.ai/api/mcp/auth_callback",
  "scopes": ["shopping:read", "chores:read", "offline_access"],
  "enabled": true
}
```

For ChatGPT use `provider: "chatgpt"` and the exact callback displayed by that
account's tested connection UI. For Gemini use `provider: "gemini"` and the exact
Google callback displayed there (`https://oauth-redirect.googleusercontent.com/r/…`).
Do not copy another account's path. Gemini's updated risk disclosure must be
shown and accepted at member consent; operator registration is not that consent.
This tool supports only public-client callback shapes verified in the guides.
It refuses generic aliases, confidential-client secrets, extra config
fields, broad/write scopes and mismatched deployment origins. A different surface
requires a separately reviewed profile and credential flow.

`enabled` defaults false; setting it true must be explicit in the reviewed plan.
The tool creates clients; it does not edit/reactivate existing profiles. Decide
the intended state before the first apply. Even an enabled profile grants no
household data without household opt-in and the member's later consent.

From the repository root, using absolute private file paths:

```powershell
mise exec -- node packages/auth/dist/mcp-client-cli.js --config C:/PRIVATE-PILOT/client.json
```

The default is a preview. It opens no DB connection and makes no remote request.
It can run with `MCP_ENABLED=false`. Review the printed canonical origin, provider,
scopes, profile version, enabled state and `sha256`. Review the exact callback in
the private config too: the printed summary shows only its origin. The digest
binds all the registration fields, including the callback. It is a confirmation
value, not a credential. Any material config change requires a new preview/hash.

## Apply once, under target authorization

After target approval, save only the raw **Cookie header value** from the current
member's target session into `session.private` in the private directory. This is
a short-lived credential: never paste it in chat, shell history, a URL, a manifest
or a support ticket. The file must contain a single header value, without the
`Cookie:` label, JSON wrapper or other headers. Do not send it to an assistant.

Apply requires the target's `MCP_ENABLED=true`, `MCP_SYNTHETIC_DEPLOYMENT=false`,
demo off, matching config origin and a restricted app role. No flag changes these
settings for you. With the reviewed preview hash and a **new** receipt filename:

```powershell
mise exec -- node packages/auth/dist/mcp-client-cli.js --config C:/PRIVATE-PILOT/client.json --apply --confirm-plan SHA256_FROM_PREVIEW --cookie-file C:/PRIVATE-PILOT/session.private --receipt-file C:/PRIVATE-PILOT/attempt-01.json
```

The receipt is exclusively created and synced before registration starts. Success
prints only registration metadata and the public client ID; it includes no client
secret, member cookie, tokens or callback path. Enter the public ID in the tested
assistant setup and leave its secret blank. Member consent remains a separate
interactive step. No MCP tools, fixture login, household toggles or OAuth grants
are invoked automatically.

A receipt present before invocation is never reused or replayed. Status updates
during the same attempt use a synced temporary file in the same directory followed
by atomic replacement, so readers see the previous or next complete JSON record.
An interruption during initial creation can leave an incomplete record before any
registration call. A failed/interrupted call may
have created a client before the final result was saved; `attempting`, `uncertain`
or an incomplete receipt means **inspect before retry**. Keep that receipt, check
the target's operator-visible provider/profile records through authorized support
access, and reconcile whether a client exists. Do not retry with a new filename
merely to bypass the guard. The tool cannot promise network-wide exactly-once
registration or roll back the maintained provider's partial failure.

Errors are static/redacted. Do not enable raw SQL/provider payload logging to
investigate them. Once the attempt has been reconciled, remove the private session
file through the operator's normal credential-handling process; retain only the
needed metadata receipt under the agreed pilot retention. No tool deletes user
sessions, ordinary Google grants or existing provider credentials.

## Local evidence and limits

Focused tests cover changed-plan denial, provider/callback/scope restrictions,
bounded session files, exclusive receipts, credential redaction and uncertain
attempt preservation. The real restricted-role single/shared authorization suite
also registers a disabled household profile through the existing provider with
a valid synthetic session, denies an invalid session, and verifies no member
connection/consent was created. Additional Gemini cases verify default-disabled
profiles, refusal without privacy acceptance or with the old policy version,
explicit fresh consent and immediate revocation. Fixtures contain fictional data only.
No real operator target, live assistant profile or consented pilot is established
by these checks.
