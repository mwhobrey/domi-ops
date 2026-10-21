# MCP M1 compatibility evidence

This isolated package validates dependency and authorization design choices. It
does not register production clients, read `.env`, mount household data or change
application dependencies. Its fixture passwords are disposable local constants.

From this directory, with the repository's mise Node 22 runtime:

```powershell
mise exec -- npm ci --workspaces=false --ignore-scripts --no-audit --no-fund
mise exec -- npm run typecheck
mise exec -- npm run probe
./run-postgres.ps1
```

The PostgreSQL wrapper creates one labeled, temporary container with no persistent
volume, bound to `127.0.0.1:55487`, and stops/removes it in `finally`. It refuses
to reuse an existing container of that name. No pre-existing database is reset.
Docker must be available and that port/name must be free. Synthetic PostgreSQL
tables come from the installed provider schema; they are not production migrations.

Receipts contain test names, dependency constraints and schema metadata, without
passwords, cookies, tokens, JWT values, private keys or real household records.
`receipt.json` has 16 checks and `receipt-postgres.json` has 18. The TypeScript
5.8.3 import/composition probe is a separate check. `skipLibCheck` matches the
bounded application-facing compatibility check; it is not a library type audit.

Findings:

- Keep Better Auth/provider/core at 1.7.10 with better-call 1.4.2. A clean install
  otherwise selected core 1.7.12 and failed peer resolution. Do not use `--force`
  or `--legacy-peer-deps` to hide the mismatch.
- Resource scope policy must include `offline_access` when refresh rotation is
  expected. It is not a permission to access another domain or execute jobs.
- Consent must use the signed query returned by the provider. The provider
  continuation needs a real HTTP request context, not a bare internal API call.
- JWT signature verification alone does not observe connection revocation;
  an application grant must be checked on every protected call.
- The Hono adapter sets `parsedBody` but does not export that variable's type;
  the TypeScript probe declares the context variable rather than bypassing types.

The RLS fixture proves the proposed grant-table policy shape under a restricted
role. It does not prove Domi Ops tenant, note ACL or module/subscription integration.
Those tests belong to WHO-469–WHO-473. Actual proxy/TLS deployments and ChatGPT,
Claude and Gemini account interoperability remain M2–M4 acceptance work.
