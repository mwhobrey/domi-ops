# ADR 002: Marketing site topology

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-06-24 |
| **Linear** | [WHO-183](https://linear.app/mikewhob-whome/issue/WHO-183) |
| **Related** | [ADR 001](./001-public-launch-scope.md), [WHO-134](https://linear.app/mikewhob-whome/issue/WHO-134), [WHO-189](https://linear.app/mikewhob-whome/issue/WHO-189) |

## Context

Public launch needs a marketing surface on `domi-ops.com` separate from the product on `app.domi-ops.com`. An initial landing lived behind `MARKETING_LANDING=true` in `apps/web`, coupling marketing deploys to the full application image.

## Decision

| Host | App | Purpose |
|------|-----|---------|
| `https://domi-ops.com` | `apps/www` | Landing, pricing, docs links — **no auth, no API** |
| `https://app.domi-ops.com` | `apps/web` | Product (login, dashboard, modules) |
| `https://demo.domi-ops.com` | `apps/web` | Shared demo household (`DEMO_MODE=true`) |

Shared UI primitives live in `packages/marketing-ui` (screenshots, shell chrome, theme tokens).

## Cookie and auth boundary

- Session cookies are set only on `app.domi-ops.com` (`PUBLIC_APP_URL` on app deploy).
- Marketing links to `https://app.domi-ops.com/login` — no cross-subdomain cookie on apex.
- Demo deploy uses the app image with `DEMO_MODE=true`; same cookie rules as app.

## Environment matrix

| Variable | `apps/www` | `apps/web` (app) | `apps/web` (demo) |
|----------|------------|------------------|-------------------|
| `PUBLIC_APP_URL` | N/A | `https://app.domi-ops.com` | `https://demo.domi-ops.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app.domi-ops.com` (CTA links) | same as PUBLIC | same as PUBLIC |
| `DEMO_MODE` | — | `false` | `true` |
| `MARKETING_LANDING` | — | removed (not used) | — |

## Caddy (example)

See `deploy/Caddyfile.domi-ops.example`:

```caddy
domi-ops.com {
    reverse_proxy domiops-www:3000
}
app.domi-ops.com {
    reverse_proxy domiops-web:3000
}
demo.domi-ops.com {
    reverse_proxy domiops-demo-web:3000
}
```

## Docker Compose

`docker-compose.marketing.yml` adds `www` service (standalone Next output). App and demo stacks use existing `docker-compose.prod.yml` patterns with different `PUBLIC_APP_URL` / `DEMO_MODE`.

## Consequences

**Positive**

- Marketing deploys without rebuilding api/worker.
- Clear security story: apex never runs auth handlers.
- Screenshot assets live under `apps/www/public/` only.

**Negative**

- Shared styles/components maintained in `packages/marketing-ui`.
- Legal pages (`/privacy`, `/terms`) may exist on both www (links) and app until unified.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Same `apps/web` image, `MARKETING_LANDING` on apex | Couples marketing + product releases |
| Static HTML export only | Loses Next ergonomics for pricing data; team already on Next |
| Separate repo for marketing | Unnecessary monorepo overhead for v1 |
