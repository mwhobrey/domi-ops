import type Database from "better-sqlite3";
import type { createDb } from "@whome/db";
import type { HomeHubConfig } from "../lib/homehub-config.js";
import type { DirectoryMember } from "../lib/member-directory.js";
import type { ImportRecordIndex } from "../lib/import-record-index.js";

export interface ImportContext {
  sqlite: Database.Database;
  dryRun: boolean;
  householdId: string;
  /** Present for live import; omitted for `--dry-run`. */
  databaseUrl?: string;
  uploadsPath?: string;
  idMap: Map<string, string>;
  db?: ReturnType<typeof createDb>;
  homeHubConfig: HomeHubConfig;
  memberDirectory: Map<string, DirectoryMember>;
  configPath: string;
  importRecordIndex?: ImportRecordIndex;
}

export interface MapperResult {
  imported: number;
  skipped: number;
  warnings: string[];
}
