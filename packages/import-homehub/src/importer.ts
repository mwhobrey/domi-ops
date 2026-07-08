import type { ImportOptions, ImportReport } from "./importer-types.js";
export type { ImportOptions, ImportReport } from "./importer-types.js";

import Database from "better-sqlite3";
import { closeDb, createDb, type Database as PgDatabase } from "@domi-ops/db";
import { importCalendar } from "./mappers/calendar.js";
import { importExpenses } from "./mappers/expenses.js";
import { importFiles } from "./mappers/files.js";
import { importHouseholdMembers } from "./mappers/household-members.js";
import { importHousehold } from "./mappers/household.js";
import { importNotices } from "./mappers/notices.js";
import { importNotes } from "./mappers/notes.js";
import { importSchool } from "./mappers/school.js";
import { importShopping } from "./mappers/shopping.js";
import { importTasks } from "./mappers/tasks.js";
import type { ImportContext } from "./mappers/types.js";
import { buildMemberDirectory } from "./lib/member-directory.js";
import { loadHomeHubConfig, resolveConfigPath } from "./lib/homehub-config.js";
import { ImportRecordIndex } from "./lib/import-record-index.js";

function logStep(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function runImport(options: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = {
    dryRun: options.dryRun,
    counts: {},
    warnings: [],
    errors: [],
  };

  const configPath = resolveConfigPath(options.sqlitePath, options.configPath);
  if (!configPath) {
    report.errors.push(
      "HomeHub config.yml is required — pass --config or place config.yml next to app.db",
    );
    return report;
  }

  let homeHubConfig;
  try {
    homeHubConfig = loadHomeHubConfig(configPath);
  } catch (e) {
    report.errors.push(
      `Cannot parse config.yml (${configPath}): ${e instanceof Error ? e.message : String(e)}`,
    );
    return report;
  }

  let sqlite: Database.Database;
  try {
    sqlite = new Database(options.sqlitePath, { readonly: true });
  } catch (e) {
    report.errors.push(`Cannot open SQLite: ${e instanceof Error ? e.message : String(e)}`);
    return report;
  }

  let db: PgDatabase | undefined;

  try {
    const memberDirectory = buildMemberDirectory(homeHubConfig, sqlite);
    report.counts.config_members = memberDirectory.size;
    report.warnings.push(`using HomeHub config: ${configPath}`);

    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    report.counts.sqlite_tables = tables.length;

    if (!options.dryRun && !options.databaseUrl) {
      report.errors.push("DATABASE_URL is required for live import");
      return report;
    }

    db = options.dryRun ? undefined : createDb(options.databaseUrl!);
    const householdName =
      options.householdName === "Imported Household" && homeHubConfig.instanceName
        ? homeHubConfig.instanceName
        : options.householdName;

    logStep("import: household…");
    const { householdId, result: hhResult } = await importHousehold(
      {
        sqlite,
        dryRun: options.dryRun,
        householdId: "",
        databaseUrl: options.databaseUrl,
        uploadsPath: options.uploadsPath,
        idMap: new Map(),
        db,
        homeHubConfig,
        memberDirectory,
        configPath,
      },
      householdName,
    );
    report.counts.household = hhResult.imported;
    report.warnings.push(...hhResult.warnings);

    const importRecordIndex =
      db && !options.dryRun
        ? await ImportRecordIndex.load(db, householdId)
        : undefined;
    if (importRecordIndex) {
      logStep(`import: ${importRecordIndex.size} prior import_records loaded`);
    }

    const ctx: ImportContext = {
      sqlite,
      dryRun: options.dryRun,
      householdId,
      databaseUrl: options.databaseUrl,
      uploadsPath: options.uploadsPath,
      idMap: new Map(),
      db,
      homeHubConfig,
      memberDirectory,
      configPath,
      importRecordIndex,
    };

    logStep("import: household members…");
    const memberResult = await importHouseholdMembers(ctx);
    report.counts.household_members = memberResult.imported;
    report.counts.household_members_skipped = memberResult.skipped;
    report.warnings.push(...memberResult.warnings);

    const steps = [
      ["notices", importNotices],
      ["calendar", importCalendar],
      ["tasks", importTasks],
      ["shopping", importShopping],
      ["notes", importNotes],
      ["expenses", importExpenses],
      ["files", importFiles],
      ["school", importSchool],
    ] as const;

    for (const [name, fn] of steps) {
      logStep(`import: ${name}…`);
      const r = await fn(ctx);
      report.counts[name] = r.imported;
      report.counts[`${name}_skipped`] = r.skipped;
      report.warnings.push(...r.warnings);
      logStep(`import: ${name} done (${r.imported} imported, ${r.skipped} skipped)`);
    }
  } finally {
    sqlite.close();
    if (db) await closeDb(db);
  }

  return report;
}
