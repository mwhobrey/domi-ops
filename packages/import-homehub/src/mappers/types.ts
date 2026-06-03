import type Database from "better-sqlite3";

export interface ImportContext {
  sqlite: Database.Database;
  dryRun: boolean;
  householdId: string;
  databaseUrl: string;
  uploadsPath?: string;
  idMap: Map<string, string>;
}

export interface MapperResult {
  imported: number;
  skipped: number;
  warnings: string[];
}
