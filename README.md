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

- Web: http://localhost:3001 (Docker; avoids conflict if :3000 is in use)  
- API: http://localhost:4000/health  

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

## License

MIT (add LICENSE file before public publish)
