# whome

Open-source household operations platform — calendar, homeschool, and daily life. Built to replace [HomeHub](https://github.com/surajverma/homehub) with a modern stack and enterprise-grade UX.

## Stack

- **Monorepo** — npm workspaces + Turborepo
- **web** — Next.js 15
- **api** — Hono
- **worker** — BullMQ (Google Calendar sync, recurring jobs)
- **db** — Drizzle + PostgreSQL
- **Deploy** — Docker Compose (DigitalOcean + Caddy)

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

## HomeHub import

```bash
npm rebuild better-sqlite3 -w @whome/import-homehub   # if Node version changed
npm run import:homehub -- --sqlite ../homehub/data/app.db --dry-run
```

Google Cloud Console needs **both** redirect URIs (see `.env.example`).

## Production (your droplet)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [deploy/Caddyfile.example](deploy/Caddyfile.example).

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY, Google OAuth

docker compose -f docker-compose.prod.yml up -d --build
```

Swap Caddy upstream from HomeHub to `web:3000`.

## Tests

```bash
npm run fixture:homehub   # minimal SQLite for import dry-run tests
npm run test
```

## HomeHub data paths

See [docs/HOMEHUB_IMPORT.md](docs/HOMEHUB_IMPORT.md) for copying `app.db` from your droplet and running import/cutover.

## License

MIT — see [LICENSE](LICENSE).
