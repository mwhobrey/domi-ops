# HomeHub → Domi Ops import

## Copy data from the droplet (prerequisite)

HomeHub data lives on your DigitalOcean droplet. Copy it to your dev machine before running mappers or the integration gate:

```bash
# Replace USER, HOST, and paths with your HomeHub install
scp USER@HOST:/path/to/homehub/data/app.db ./fixtures/homehub/app.db
scp -r USER@HOST:/path/to/homehub/uploads ./fixtures/homehub/uploads
scp USER@HOST:/path/to/homehub/config.yml ./data/config.yml
```

On the droplet you can run import directly without copying:

```bash
npm run import:homehub -- --sqlite /path/to/homehub/data/app.db --uploads /path/to/homehub/uploads --dry-run
```

## Environment

- **`--dry-run` / `npm run import:validate`:** SQLite path + **`config.yml`** (auto-discovered beside `app.db` or one directory up).
- **Live import:** `DATABASE_URL` — target Postgres; HomeHub **`config.yml`** required (`--config` or `./data/config.yml` next to `app.db`).
- Copy from droplet: `app.db`, `uploads/`, and **`config.yml`** (secrets redacted locally is fine — import reads auth roster + school block only).
- For file uploads during import: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE=true` (MinIO)

## Commands

```bash
docker compose up -d postgres redis minio
npm run build
npm run db:migrate

# Validate (CI / local fixture)
npm run import:validate

# Validate real DB (strict — exit 1 on any warning)
npm run import:homehub -- --sqlite ./fixtures/homehub/app.db --uploads ./fixtures/homehub/uploads --dry-run --strict

# Live import (config.yml beside app.db or pass --config)
npm run import:homehub -- --sqlite ./data/app.db --uploads ./data/uploads

# Idempotency check (expect mostly skipped)
npm run import:homehub -- --sqlite ./fixtures/homehub/app.db --uploads ./fixtures/homehub/uploads
```

## Cutover order (production)

1. **Import first** into prod Postgres (creates household + `@imported.local` stub users; **`config.yml`** supplies claim emails from `auth.display_names` / `allowed_emails` and school roster for members missing from `home_status`).
2. **Then** each family member signs in once (Google or email) — stubs are claimed via **imported claim emails** (from config.yml), Google display name, or username match. Set display names on **Profile** as needed. Home/away is imported from HomeHub `home_status.status`.

**Single-tenant dogfood:** If you already logged in before import, the next session will move you onto the import household and claim your stub. Cleanest cutover: `npm run dev:reset` → import → then sign in.
3. Connect Google Calendar → full import.
4. Swap Caddy to `web:3000` per [deploy/CUTOVER.md](../deploy/CUTOVER.md).

## Mappers (live)

| HomeHub table | Domi Ops target |
|---------------|--------------|
| `notice` | `notices` |
| `todo_item` / `chore` | `chores` |
| `note` | `notes` (content, creator, timestamp; optional tags/visibility if present in SQLite) |
| `personal_calendar` | `calendars` (native lanes — Family, School, etc.) |
| `reminder.category` | `calendar_events.category_key` (event tags, not separate lanes) |
| HomeHub fallback bucket | one `calendars` row named &quot;Imported from HomeHub&quot; (deduped via `import_records` on re-import) |
| `reminder` | `calendar_events` |
| `school_*` + `school_submission_artifact` | school schema + S3 keys via `file` mapper |
| `file` | S3 `imports/{householdId}/files/…` |

Regression baseline: [IMPORT_REPORT.example.json](./IMPORT_REPORT.example.json).

## Tests

Set `DOMI_OPS_FIXTURE_DB` to a copied `app.db` for optional integration tests; the repo includes a minimal generated fixture under `packages/import-homehub/fixtures/`.
