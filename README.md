# Domi Ops

**Domi Ops** is an open-source household operations platform — calendar, chores, shopping, notes, expenses, homeschool, and shared files in one place. It is built for families who want a modern, polished experience without running a pile of separate apps, with **minimal self-host setup** (Docker Compose, one Postgres, sensible defaults). **Self-host and Domi Ops hosted** (managed cloud) are planned to **launch together** as open source once the product is stable, security-reviewed, and hosted operations are ready — not as a staged “OSS first, cloud later” rollout.

## What you get

- **Dashboard** — weather, glance at chores and school, household presence, notice board
- **Calendar** — month/week/day/agenda, Google Calendar import and sync, reminders
- **Chores & shopping** — lists, recurring items, karma, reports
- **School** — classes, assignments, submissions, gradebook (homeschool-friendly)
- **Notes & Drive** — markdown notes, household file storage, sharing
- **Expenses** — tracking, budgets, alerts
- **PWA** — install on phones; Web Push for notices and deadline reminders (optional VAPID)

Modules are toggled per household. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the product map.

**New here?** Start with **[docs/SETUP.md](docs/SETUP.md)** — setup paths, configuration, optional Google integration, and best practices for household admins.

## Stack

- **Monorepo** — npm workspaces + Turborepo
- **web** — Next.js 15
- **api** — Hono
- **worker** — BullMQ (calendar sync, recurring jobs, reminder scans)
- **db** — Drizzle + PostgreSQL
- **Deploy** — Docker Compose (self-host); Caddy reverse proxy in production examples

## Quick start (local)

```bash
cp .env.example .env
# Edit SESSION_SECRET, ENCRYPTION_KEY for production

docker compose up -d postgres redis minio
npm install
npm run build
npm run db:migrate   # required before first login
npm run dev
```

**Reset local DB** (wipe Docker volumes, re-migrate, flush Redis):

```bash
npm run dev:reset
npm run dev
```

- **Web (default):** http://localhost:3000 — `PUBLIC_APP_URL` in `.env` must match this origin for Google OAuth.
- **API:** http://localhost:4000/health (includes `dev.oauthRedirects` in development).
- **Full stack in Docker** (web on host :3001): copy `.env.docker.example` → `.env`, then `docker compose up --build`. Do not mix with native `npm run dev` on :3000.

## Self-host (production)

See **[docs/SETUP.md](docs/SETUP.md)** (recommended), [docs/SELF_HOST.md](docs/SELF_HOST.md), and [deploy/CUTOVER-WHOBBREY.md](deploy/CUTOVER-WHOBBREY.md).

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY, S3_ACCESS_KEY, S3_SECRET_KEY, Google OAuth

docker compose -f docker-compose.prod.yml up -d --build

# Behind an existing reverse proxy (shared Docker network):
# PROXY_NETWORK=your_proxy_network docker compose \
#   -f docker-compose.prod.yml -f docker-compose.proxy-external.yml up -d --build
```

Pre-built images are published to GHCR on `main` and version tags — see `docker-compose.prod.yml` and `DOMI_OPS_IMAGE_TAG` for pull-only deploys.

## Migrating from HomeHub

If you are coming from [HomeHub](https://github.com/surajverma/homehub), Domi Ops includes an import path for SQLite data and uploads. This is **optional**; you can also start fresh.

```bash
npm rebuild better-sqlite3 -w @domi-ops/import-homehub   # if Node version changed
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads --dry-run
```

Details: [docs/HOMEHUB_IMPORT.md](docs/HOMEHUB_IMPORT.md). Google Cloud Console needs redirect URIs for your `PUBLIC_APP_URL` (see `.env.example`).

## Tests

```bash
npm run fixture:homehub   # minimal SQLite for import dry-run tests
npm run test
```

## Roadmap

| Phase | Focus |
|-------|--------|
| **Now** | Dogfood on self-host; harden security, fix bugs, finish hosted ops |
| **Public launch** | **Open source + Domi Ops hosted together** — same codebase, your server or ours |
| **Ongoing** | Self-host docs, community, and hosted tiers per [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

Hosted multi-tenant code is not live yet; launch waits until self-host and hosted are both ready to ship.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
