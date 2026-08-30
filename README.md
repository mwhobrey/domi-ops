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
git clone https://github.com/mwhobrey/domi-ops.git
cd domi-ops
cp .env.example .env
# Edit SESSION_SECRET, ENCRYPTION_KEY for production

docker compose up -d postgres redis minio
npm install
npm run build
npm run db:migrate   # required before first login
npm run dev
```

**First login (local greenfield):** with `ALLOW_PUBLIC_SIGNUP=false`, set `SETUP_TOKEN` in `.env`, open http://localhost:3000/setup, or run `npm run bootstrap:owner`.

**Reset local DB** (wipe Docker volumes, re-migrate, flush Redis):

```bash
npm run dev:reset
npm run dev
```

- **Web (default):** http://localhost:3000 — `PUBLIC_APP_URL` in `.env` must match this origin for Google OAuth.
- **API:** http://localhost:4000/health (includes `dev.oauthRedirects` in development).
- **Full stack in Docker** (web on host :3001): copy `.env.docker.example` → `.env`, then `docker compose up --build`. Do not mix with native `npm run dev` on :3000.

## Self-host (production)

See **[docs/SETUP.md](docs/SETUP.md)** (recommended) and [docs/SELF_HOST.md](docs/SELF_HOST.md).

```bash
git clone https://github.com/mwhobrey/domi-ops.git
cd domi-ops
cp .env.example .env
# Set POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY, S3_ACCESS_KEY, S3_SECRET_KEY
# Greenfield: SETUP_TOKEN (min 16 chars) for /setup or bootstrap:owner

export DOMI_OPS_IMAGE_TAG=latest   # or a version tag — see docs/RELEASE_PROCESS.md
docker compose -f docker-compose.prod.yml pull api worker web
docker compose -f docker-compose.prod.yml up -d --no-build
# Then open https://your.domain/setup (or npm run bootstrap:owner on the server)
```

Pre-built images are published to GHCR on `main` and version tags — no login required to pull
them. See [SETUP.md Path C](docs/SETUP.md#path-c-production-with-pre-built-images) for details,
or build from source instead (`docker compose ... up -d --build`) if you're running a fork with
local changes.

**Stuck?** [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

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

## Get help

- **Setup problems:** [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) first, then open a
  [self-host help issue](../../issues/new?template=self_host_help.yml).
- **Bug?** [File a bug report](../../issues/new?template=bug_report.yml).
- **Idea or request?** [File a feature request](../../issues/new?template=feature_request.yml).
- **Open-ended question?** Use [Discussions](../../discussions) instead of an issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
