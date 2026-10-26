# DNS cutover — domi-ops.com

Registrar steps for [WHO-183](https://linear.app/mikewhob-whome/issue/WHO-183). Topology: [ADR 002](../adr/002-marketing-site-topology.md).

## Records

| Host | Type | Target | Serves |
|------|------|--------|--------|
| `@` (apex) | A / AAAA | Marketing VPS IP | `domi-ops.com` → `apps/www` |
| `app` | A / CNAME | App VPS IP or host | `app.domi-ops.com` → `apps/web` |
| `demo` | A / CNAME | Demo VPS IP or same as app | `demo.domi-ops.com` → `apps/web` (DEMO_MODE) |
| `www` | CNAME | `domi-ops.com` | Redirect → `https://domi-ops.com` |
| `www.app` | CNAME | `app.domi-ops.com` | Redirect → `https://app.domi-ops.com` |
| `www.demo` | CNAME | `demo.domi-ops.com` | Redirect → `https://demo.domi-ops.com` |

**Note:** Apex and app can share one VPS with Caddy vhost routing (see `deploy/Caddyfile.domi-ops.example`).

In Squarespace, enter the relative host (`www`, `www.app`, `www.demo`) and the
full target shown above; a 30-minute TTL is suitable. Keep an existing matching
record. A CNAME cannot coexist with an A/AAAA record at the same name. Only
publish AAAA when the destination server actually serves the site over IPv6.

Use DNS records rather than registrar URL forwarding. The explicit `www` site
blocks in the Caddy example obtain their own certificates and issue a permanent
308 redirect, preserving the path, query string and HTTP method. DNS alone does
not provide the HTTPS redirect. Keep application URLs, cookies and OAuth callback
URIs on their canonical `app` / `demo` hosts; the aliases redirect before reaching
the application. No wildcard DNS record or wildcard certificate is needed.

## TLS

- Caddy obtains Let's Encrypt certs per hostname.
- Confirm ports **80** and **443** open on firewall.
- Every alias needs working DNS and its explicit Caddy site block, even though
  it only redirects. HTTPS negotiates its certificate before sending a redirect.

## Pre-cutover checklist

- [ ] `apps/www` builds and serves `/` + `/pricing` on staging port
- [ ] `apps/web` serves `/login` with `PUBLIC_APP_URL=https://app.domi-ops.com`
- [ ] Google OAuth redirect URIs updated for `app.domi-ops.com` (if used on hosted)
- [ ] Session cookies scoped to `app.domi-ops.com` only (marketing apex has no auth)

## Cutover order

1. Lower TTL on existing records (24h before).
2. Point `app.domi-ops.com` first; smoke-test login.
3. Point `domi-ops.com`; verify landing + pricing.
4. Point `demo.domi-ops.com`; run `db:seed-demo` + login smoke test.
5. Raise TTL after stable.

## Existing hosted installation: add www aliases

The production `Caddyfile` is untracked and is not updated by a release or by
editing the example. Back it up, then add only the three `www` site blocks from
`deploy/Caddyfile.domi-ops.example` to the existing file. Preserve the production
upstreams, routes and settings; do not replace it with the example.

After the DNS records resolve to the intended server, validate the mounted file
with `docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
If validation passes, use the existing hosted procedure (`docker restart caddy`;
see [HOSTED_BETA_SETUP.md](../../deploy/HOSTED_BETA_SETUP.md#4-caddy-reverse-proxy--tls)).
Confirm certificate issuance in the logs and test all three aliases:

```bash
for host in www.domi-ops.com www.app.domi-ops.com www.demo.domi-ops.com; do
  curl -sSIL --max-redirs 5 "http://$host/pricing?source=www-check"
  curl -sSI "https://$host/pricing?source=www-check"
done
```

HTTPS must return 308 with `Location: https://<canonical-host>/pricing?source=www-check`.
HTTP may first redirect to HTTPS on the same alias; following the chain must reach
the canonical host without a TLS error or loop. Also verify the apex landing page,
`app.domi-ops.com/login`, `app.domi-ops.com/api/healthz` and the demo login still work.
For rollback, restore the saved production file, validate it and restart Caddy.

## Rollback

Keep dogfood `whome.whobrey.me` DNS until launch sign-off ([WHO-187](https://linear.app/mikewhob-whome/issue/WHO-187)).
