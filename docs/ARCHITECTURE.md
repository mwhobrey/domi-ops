# Domi Ops architecture

> **Public launch (OSS + hosted):** see [ADR 001 — Public launch scope](./adr/001-public-launch-scope.md) (brand: **Domi Ops**, `domi-ops.com` / `app.domi-ops.com`). This file describes the current codebase; the ADR is the launch source of truth.

## Product tiers

Domi Ops is designed for **two ways to run the same product**: self-host (OSS) or Domi Ops hosted (managed). **Public launch targets both at once** — open source and hosted tiers ship together when stability, security, and hosted operations are ready. Until then, development focuses on self-host dogfood.

| Tier | Deployment | Database |
|------|------------|----------|
| **OSS (free)** | Self-host Docker | Your Postgres (single household) |
| **Hosted Starter** | Domi Ops cloud | Shared Postgres + RLS |
| **Hosted Family** | Domi Ops cloud | Dedicated Neon project per household |
| **Add-ons** | Either | `school`, `calendar_sync`, `media` (future) |

**Current code:** self-host `DEPLOYMENT_MODE=single` is the default dogfood path. **Hosted Starter foundation** (`DEPLOYMENT_MODE=shared`) is implemented — RLS (`0038`/`0039`), tenant context, entitlements, `docker-compose.hosted.yml` — but billing/provisioning (M5) is not wired yet.

## v1 modules (Mike's household)

- **core** — dashboard, shopping, chores, notes, expenses, files
- **school** — homeschool LMS (always on self-host; optional on hosted)
- **calendar_sync** — Google Calendar OAuth, import-first default, worker-backed sync

## Services

| Service | Role |
|---------|------|
| `web` | Next.js UI, proxies `/api` to `api` |
| `api` | Hono REST, Better Auth (`/auth/*`), calendar OAuth |
| `worker` | BullMQ: Google pull/push, recurring materialization |
| `postgres` | Primary data |
| `redis` | Queues + rate limits |
| `minio` | S3-compatible files (school uploads, shared files) |

## Google Calendar (v1)

Wife migration path: connect Google → **full import** → run household on Domi Ops → optional ongoing sync until Google is abandoned.

Default: `GOOGLE_CALENDAR_DEFAULT_SYNC_MODE=import_only`

Modes: `import_only` | `manual` | `bidirectional` (same semantics as HomeHub fork)

Port from: `homehub/app/google_calendar/*`

## HomeHub migration

```bash
npm run import:homehub -- --sqlite /path/to/data/app.db --uploads /path/to/uploads --dry-run
```

Writes `import_records` for idempotent re-runs.

## DigitalOcean cutover

1. Build on droplet: `docker compose -f docker-compose.prod.yml up -d --build`
2. Migrations run automatically on API container start (`apps/api/Dockerfile` entrypoint). To run manually: `docker compose -f docker-compose.prod.yml exec api node /app/packages/db/dist/migrate.js`
3. Import: `domi-ops-import --sqlite ...`
4. Point Caddy `reverse_proxy` from homehub container to `web:3000`
5. Verify calendar + school before stopping HomeHub
