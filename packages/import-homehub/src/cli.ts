#!/usr/bin/env node
import { Command } from "commander";
import { runImport } from "./importer.js";

const program = new Command()
  .name("whome-import")
  .description("Migrate data from HomeHub (SQLite) into whome (PostgreSQL)")
  .requiredOption("--sqlite <path>", "Path to HomeHub data/app.db")
  .option("--uploads <path>", "Path to HomeHub uploads directory")
  .option("--dry-run", "Validate and report without writing", false)
  .option("--strict", "Exit 1 on import warnings", false)
  .option("--household-name <name>", "Name for the new household", "Imported Household")
  .action(async (opts) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error("DATABASE_URL is required");
      process.exit(1);
    }
    const report = await runImport({
      sqlitePath: opts.sqlite,
      uploadsPath: opts.uploads,
      dryRun: opts.dryRun,
      householdName: opts.householdName,
      databaseUrl,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length > 0) process.exit(1);
    if (opts.strict && report.warnings.length > 0) process.exit(1);
  });

program.parse();
