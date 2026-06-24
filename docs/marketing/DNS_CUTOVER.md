# DNS cutover — domi-ops.com

Registrar steps for [WHO-183](https://linear.app/mikewhob-whome/issue/WHO-183). Topology: [ADR 002](../adr/002-marketing-site-topology.md).

## Records

| Host | Type | Target | Serves |
|------|------|--------|--------|
| `@` (apex) | A / AAAA | Marketing VPS IP | `domi-ops.com` → `apps/www` |
| `app` | A / CNAME | App VPS IP or host | `app.domi-ops.com` → `apps/web` |
| `demo` | A / CNAME | Demo VPS IP or same as app | `demo.domi-ops.com` → `apps/web` (DEMO_MODE) |

**Note:** Apex and app can share one VPS with Caddy vhost routing (see `deploy/Caddyfile.domi-ops.example`).

## TLS

- Caddy obtains Let's Encrypt certs per hostname.
- Confirm ports **80** and **443** open on firewall.

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

## Rollback

Keep dogfood `whome.whobrey.me` DNS until launch sign-off ([WHO-187](https://linear.app/mikewhob-whome/issue/WHO-187)).
