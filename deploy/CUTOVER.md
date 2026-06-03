# Production cutover (same droplet as HomeHub)

## Pre-flight

- [ ] `.env` on droplet: `POSTGRES_PASSWORD`, `SESSION_SECRET` (32+), `ENCRYPTION_KEY`, Google OAuth, `PUBLIC_APP_URL=https://your.domain`
- [ ] Google Cloud: both redirect URIs on `PUBLIC_APP_URL` ([docs/GOOGLE_OAUTH_SETUP.md](../docs/GOOGLE_OAUTH_SETUP.md))
- [ ] HomeHub `app.db` + `uploads/` paths known on server

## Staging pass (recommended)

```bash
docker compose -f docker-compose.prod.yml up -d --build
# Migrations run via API container entrypoint
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads --dry-run
npm run import:homehub -- --sqlite /path/to/app.db --uploads /path/to/uploads
```

## Smoke tests

- [ ] `GET https://your.domain/api/health` (or via web rewrite)
- [ ] Google login → dashboard
- [ ] `/school`, `/calendar`, core modules
- [ ] Calendar connect → worker processes `google.calendar.full_import`
- [ ] School presign upload lands in MinIO

## Caddy swap

1. Update Caddyfile: `reverse_proxy web:3000` (see [Caddyfile.example](./Caddyfile.example))
2. `caddy reload` or restart Caddy container
3. Verify HTTPS site loads whome

## Soak & rollback

- Run 24–48h before stopping HomeHub
- **Rollback:** revert Caddy upstream to HomeHub; Postgres volume backup if needed

## After cutover

- Stop HomeHub compose stack when satisfied
- `GOOGLE_CALENDAR_DEFAULT_SYNC_MODE=import_only` unless bidirectional is implemented
