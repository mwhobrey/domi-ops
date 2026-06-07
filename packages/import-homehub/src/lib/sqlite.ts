import type Database from "better-sqlite3";

export function sqliteTableExists(sqlite: Database.Database, table: string): boolean {
  const row = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(table);
  return Boolean(row);
}

export function sqliteColumns(sqlite: Database.Database, table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** Build `SELECT col1, col2, … FROM table` using only columns that exist (SQLite schema drift). */
export function sqliteSelectExisting(
  sqlite: Database.Database,
  table: string,
  columns: string[],
  suffix = "",
): Record<string, unknown>[] {
  const available = sqliteColumns(sqlite, table);
  const selected = columns.filter((col) => available.has(col));
  if (selected.length === 0) return [];
  return sqlite
    .prepare(`SELECT ${selected.join(", ")} FROM ${table}${suffix}`)
    .all() as Record<string, unknown>[];
}
