export interface ImportOptions {
  sqlitePath: string;
  uploadsPath?: string;
  dryRun: boolean;
  householdName: string;
  databaseUrl: string;
}

export interface ImportReport {
  dryRun: boolean;
  counts: Record<string, number>;
  warnings: string[];
  errors: string[];
}
