# AI connection consent and controls (WHO-470)

The integration is included in hosted base pricing and free for self-hosting.
Both deployments use the same browser consent and member-owned grants, on top of
[WHO-469 authorization](MCP_AUTHORIZATION.md). Keep `MCP_ENABLED=false` until
gateway/tools, data policy and real-client acceptance gates pass.

## Member flow

1. An operator pre-registers an approved client and enables the deployment. Profiles
   remain disabled by default; consumer Gemini remains synthetic-only on a separate
   synthetic deployment. There is no public client registration UI.
2. An owner/admin enables the household at `/settings/ai-connections`. Each eligible
   adult member must separately consent to their own connection. Child/guest roles
   are excluded; an adult attestation is required even for an eligible role.
3. Start authorization in the assistant. Existing sessions go to `/ai/consent`;
   fresh email/username/Google sign-in preserves the provider-signed query. The
   maintained `oauthProviderClient()` sends it with sign-in. Honor the provider's
   returned consent destination; never replace it with `/dashboard` or store a
   session-global last selection.
4. Consent shows operator-approved client identity/profile, current member and
   household, exact read capabilities and external-provider handling. Notes start
   empty. Search returns at most 100 accessible same-household IDs/titles, without
   content; the backend validates selection again on preparation. Adult/privacy
   checkboxes start unchecked.
5. Deny needs no attestation. Approval prepares and consumes a one-use decision,
   then returns the provider's code redirect. Failed/uncertain approval is never
   automatically retried; restart from the assistant. Reconnection creates a new
   grant and revokes previous active grants for that household/user/client.
6. Members can review their own connections, scopes, selected notes, approval,
   expiry, revocation and last recorded tool access; disconnect; or reduce access.
   Admins cannot list someone else's grants. Missing activity means no event is
   recorded; actual tool auditing is WHO-471 onward.

Narrowing locks the current grant and permits only subsets of its current scopes
and selected notes. Widening requires fresh consent. A JWT containing a removed
scope fails its next authorization check; an assistant may request scoped-down
refresh or reconnect. Removing `offline_access` disconnects the whole grant so old
refresh credentials cannot regain background access by requesting fewer scopes;
the UI explains this before saving. Note deselection commits immediately; tools must check the
current selection **and current note permissions on every read** (WHO-471/473).
Losing note sharing also hides its title in connection settings.

Disconnect commits local denial before provider cleanup; the UI distinguishes
incomplete cleanup. Disconnect cannot erase information already copied to an
assistant. Household opt-out revokes every member's grants; re-enabling never
restores them.

## Browser control API

All paths are under `/api/mcp-auth`, use POST, require a real cookie session,
exact canonical Origin, non-cross-site metadata and a 16 KiB body bound. Read
operations use POST so browsers supply an Origin; preview creates no grant/pending
row. Responses are no-store. Runtime identity/household checks and RLS apply in
single/shared modes. Controls mount before subscription middleware so hosted
read-only mode permits security operations.

| Path | Input | Result |
| --- | --- | --- |
| `/overview` | `householdId` | Own grants only, active first, capped at 100; metadata and currently readable selected-note titles |
| `/notes` | `householdId`, optional `search` (100 chars) | At most 100 accessible IDs/titles; literal title search |
| `/consents/preview` | `householdId`, `oauthQuery` | Verified profile, scopes, policy and identity; no consent writes |
| `/consents/reject` | `oauthQuery` | Verified client denial redirect; consumes/revokes this session/query's prepared grant even if approval raced |
| `/consents/prepare` | Existing WHO-469 body | One-use pending ID; validated selections/attestations |
| `/consents/decide` | Existing WHO-469 body | Approved code redirect; no automatic retry |
| `/connections/:id/narrow` | `scopes`, `noteIds` | Owner-only, active unexpired grant; atomic subset validation/removal |
| `/connections/:id/revoke` | Empty body | Local denial plus `providerCleanupComplete` |
| `/household` | `householdId`, `enabled` | Owner/admin enablement; disabling tombstones household grants |

No control response includes bearer/refresh credentials, session IDs, signed queries,
query hashes, provider secrets or another member's private note titles.

The Next auth proxy preserves separate Set-Cookie headers. Undici labels its fetch
hop `cors`, so the provider may answer browser navigation with JSON redirects.
For actual GET navigations at authorize/social callback paths, the proxy translates
successful same-origin JSON redirects into 303 responses. AJAX retains the JSON
contract for Better Auth's default redirect plugin; login must not navigate again
after that plugin has already redirected. `/login` and `/ai/*` use no-referrer and
private/no-store response headers.

## Dependencies and verification

Web explicitly declares the already-tested provider package at the server's exact
version. Install command:

```sh
mise exec -- npm install @better-auth/oauth-provider@1.7.10 --save-exact -w @domi-ops/web
```

The lockfile adds only the web workspace declaration. No new migration or environment
variable is required. Keep the Next-generated `apps/web/AGENTS.md` so installed
version guidance remains discoverable.

Run `./scripts/test-mcp-auth.ps1` (Docker, mise, PowerShell 7.3+) for disposable
PostgreSQL 16 tests in single/shared NOBYPASSRLS modes: owner/household isolation,
private note search/title loss, denial/approval races, immutable grants, narrowing,
refresh/revocation, ordinary credential/Google sign-in and RLS. Browser continuation
and proxy regressions are in `apps/web/src/lib/{mcp,auth-proxy}.test.ts`.

The synthetic browser rehearsal uses real Next/Hono/restricted PostgreSQL with a
canceled hosted subscription: fresh email/username/Google login, empty notes and
attestations, deny, keyboard approval, code exchange, reduce access, cancel/confirm
disconnect, and no horizontal overflow at 320/375/1280 px. Google navigation/token
exchange is stubbed with fictional accounts. Local scripts/screenshots are in
ignored `.qa/who470/`. This does not establish real-vendor, production TLS/proxy or
native-shell acceptance.

Local verification: 76 explicit database/auth regressions passed; regular suite
1,491 passed / 886 environment-dependent skipped; all 17 typecheck tasks, targeted
web ESLint, API build, web production build and whitespace checks passed. The
database regressions run separately rather than relying on skipped integrations.
Owned fixture containers and browser/API/web processes were stopped after testing.

When gateway/client gates pass, repeat on self-host dogfood and hosted staging:
verify actual tool reads respect reduced scopes, deselected/private notes, revoked
membership and immediate disconnect. Review provider privacy settings externally.
