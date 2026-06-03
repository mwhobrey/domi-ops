# HomeHub → whome import

## Copy data from the droplet (prerequisite)

HomeHub data lives on your DigitalOcean droplet. Copy it to your dev machine before running mappers or the integration gate:

```bash
# Replace USER, HOST, and paths with your HomeHub install
scp USER@HOST:/path/to/homehub/data/app.db ./fixtures/homehub/app.db
scp -r USER@HOST:/path/to/homehub/uploads ./fixtures/homehub/uploads
```

On the droplet you can run import directly without copying:

```bash
npm run import:homehub -- --sqlite /path/to/homehub/data/app.db --uploads /path/to/homehub/uploads --dry-run
```

## Environment

- `DATABASE_URL` — target Postgres (local Compose or prod)
- For file uploads during import: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE=true` (MinIO)

## Commands

```bash
docker compose up -d postgres redis minio
npm run build
npm run db:migrate

# Validate
npm run import:homehub -- --sqlite ./fixtures/homehub/app.db --uploads ./fixtures/homehub/uploads --dry-run

# Live import
npm run import:homehub -- --sqlite ./fixtures/homehub/app.db --uploads ./fixtures/homehub/uploads

# Idempotency check (expect mostly skipped)
npm run import:homehub -- --sqlite ./fixtures/homehub/app.db --uploads ./fixtures/homehub/uploads
```

## Cutover order (production)

1. **Import first** into prod Postgres (creates household + legacy members).
2. **Then** Google login — links your Google user to an existing member if emails match, or creates owner household only when DB is empty.
3. Connect Google Calendar → full import.
4. Swap Caddy to `web:3000` per [deploy/Caddyfile.example](../deploy/Caddyfile.example).

See [deploy/CUTOVER.md](../deploy/CUTOVER.md) for the full checklist.

## Tests

Set `WHOME_FIXTURE_DB` to a copied `app.db` for optional integration tests; the repo includes a minimal generated fixture under `packages/import-homehub/fixtures/`.
