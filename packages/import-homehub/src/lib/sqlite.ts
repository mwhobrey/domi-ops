import type Database from "better-sqlite3";

export function sqliteTableExists(sqlite: Database.Database, table: string): boolean {
  const row = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(table);
  return Boolean(row);
}
