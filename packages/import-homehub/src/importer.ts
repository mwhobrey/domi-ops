import type { ImportOptions, ImportReport } from "./importer-types.js";
export type { ImportOptions, ImportReport } from "./importer-types.js";

import Database from "better-sqlite3";
import { importCalendar } from "./mappers/calendar.js";
import { importExpenses } from "./mappers/expenses.js";
import { importFiles } from "./mappers/files.js";
import { importHousehold } from "./mappers/household.js";
import { importNotes } from "./mappers/notes.js";
import { importSchool } from "./mappers/school.js";
import { importShopping } from "./mappers/shopping.js";
import { importTasks } from "./mappers/tasks.js";
import type { ImportContext } from "./mappers/types.js";

export async function runImport(options: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = {
    dryRun: options.dryRun,
    counts: {},
    warnings: [],
    errors: [],
  };

  let sqlite: Database.Database;
  try {
    sqlite = new Database(options.sqlitePath, { readonly: true });
  } catch (e) {
    report.errors.push(`Cannot open SQLite: ${e instanceof Error ? e.message : String(e)}`);
    return report;
  }

  try {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    report.counts.sqlite_tables = tables.length;

    const { householdId, result: hhResult } = await importHousehold(
      {
        sqlite,
        dryRun: options.dryRun,
        householdId: "",
        databaseUrl: options.databaseUrl,
        uploadsPath: options.uploadsPath,
        idMap: new Map(),
      },
      options.householdName,
    );
    report.counts.household = hhResult.imported;
    report.warnings.push(...hhResult.warnings);

    const ctx: ImportContext = {
      sqlite,
      dryRun: options.dryRun,
      householdId,
      databaseUrl: options.databaseUrl,
      uploadsPath: options.uploadsPath,
      idMap: new Map(),
    };

    const steps = [
      ["calendar", importCalendar],
      ["tasks", importTasks],
      ["shopping", importShopping],
      ["notes", importNotes],
      ["expenses", importExpenses],
      ["school", importSchool],
      ["files", importFiles],
    ] as const;

    for (const [name, fn] of steps) {
      const r = await fn(ctx);
      report.counts[name] = r.imported;
      report.counts[`${name}_skipped`] = r.skipped;
      report.warnings.push(...r.warnings);
    }
  } finally {
    sqlite.close();
  }

  return report;
}
