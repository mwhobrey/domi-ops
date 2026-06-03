import type Database from "better-sqlite3";
import type { createDb } from "@whome/db";

export interface ImportContext {
  sqlite: Database.Database;
  dryRun: boolean;
  householdId: string;
  databaseUrl: string;
  uploadsPath?: string;
  idMap: Map<string, string>;
  db: ReturnType<typeof createDb>;
}

export interface MapperResult {
  imported: number;
  skipped: number;
  warnings: string[];
}
