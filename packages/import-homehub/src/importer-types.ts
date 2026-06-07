export interface ImportOptions {
  sqlitePath: string;
  configPath?: string;
  uploadsPath?: string;
  dryRun: boolean;
  householdName: string;
  /** Required for live import; omitted for `--dry-run` (SQLite-only validation). */
  databaseUrl?: string;
}

export interface ImportReport {
  dryRun: boolean;
  counts: Record<string, number>;
  warnings: string[];
  errors: string[];
}
