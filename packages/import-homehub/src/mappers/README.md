# HomeHub → whome mappers

Implement one file per domain. Each mapper:

1. Reads SQLite rows via `better-sqlite3`
2. Resolves target IDs via `import_records` (idempotent)
3. Writes to Drizzle/Postgres

## Order

1. `household.ts` — family_members, firebase users, config.yml
2. `calendar.ts` — personal_calendar, reminder, recurring_reminder, google tables
3. `tasks.ts` — chore, todo_list, todo_item
4. `shopping.ts`, `notes.ts`, `expenses.ts`
5. `school.ts` — school_* tables
6. `files.ts` — copy uploads → S3, file metadata

## HomeHub reference

Source models: `homehub/app/models.py`
