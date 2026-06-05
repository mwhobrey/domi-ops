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

- **`--dry-run` / `npm run import:validate`:** SQLite path only — no Postgres, Docker, or `DATABASE_URL` required.
- **Live import:** `DATABASE_URL` — target Postgres (local Compose or prod); copy `.env.example` or `export DATABASE_URL=postgresql://whome:whome@localhost:5432/whome`
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

# Live import
npm run import:homehub -- --sqlite ./fixtures/homehub/app.db --uploads ./fixtures/homehub/uploads

# Idempotency check (expect mostly skipped)
npm run import:homehub -- --sqlite ./fixtures/homehub/app.db --uploads ./fixtures/homehub/uploads
```

## Cutover order (production)

1. **Import first** into prod Postgres (creates household + `@imported.local` stub users per SQLite `home_status` row with `legacy_display_name` for school/chore resolution).
2. **Then** each family member signs in once (Google or email) — stubs are claimed via `HOUSEHOLD_MEMBER_EMAIL_MAP` and/or Google display name match. Set nicknames on **Profile** as needed. Home/away is imported from HomeHub `home_status.status`.
3. Connect Google Calendar → full import.
4. Swap Caddy to `web:3000` per [deploy/CUTOVER.md](../deploy/CUTOVER.md).

## Mappers (live)

| HomeHub table | whome target |
|---------------|--------------|
| `notice` | `notices` |
| `todo_item` / `chore` | `chores` |
| `personal_calendar` | `calendars` (native lanes — Family, School, etc.) |
| `reminder.category` | `calendar_events.category_key` (event tags, not separate lanes) |
| HomeHub fallback bucket | one `calendars` row named &quot;Imported from HomeHub&quot; (deduped via `import_records` on re-import) |
| `reminder` | `calendar_events` |
| `school_*` + `school_submission_artifact` | school schema + S3 keys via `file` mapper |
| `file` | S3 `imports/{householdId}/files/…` |

Regression baseline: [IMPORT_REPORT.example.json](./IMPORT_REPORT.example.json).

## Tests

Set `WHOME_FIXTURE_DB` to a copied `app.db` for optional integration tests; the repo includes a minimal generated fixture under `packages/import-homehub/fixtures/`.
