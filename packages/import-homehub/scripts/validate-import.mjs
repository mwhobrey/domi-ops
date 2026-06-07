#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = join(__dirname, "..", "fixtures", "minimal-homehub.db");
const config = join(__dirname, "..", "fixtures", "config.yml");
const cli = join(__dirname, "..", "dist", "cli.js");

const result = spawnSync(
  process.execPath,
  [cli, "--sqlite", fixture, "--config", config, "--dry-run"],
  { env: process.env, encoding: "utf8" },
);

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

if (result.status !== 0) {
  console.error("import:validate failed");
  process.exit(result.status ?? 1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("Could not parse import report JSON");
  process.exit(1);
}

const allowedWarning = (w) =>
  w.includes("dry-run") ||
  w.includes("using HomeHub config") ||
  w.includes("table not found") ||
  w.includes("skipped") ||
  w.includes("not found in SQLite");

const badWarnings = report.warnings.filter((w) => !allowedWarning(w));
if (badWarnings.length > 0) {
  console.error("Unexpected import warnings:", badWarnings);
  process.exit(1);
}

for (const key of ["notices", "calendar", "tasks"]) {
  if (typeof report.counts[key] !== "number" || report.counts[key] < 1) {
    console.error(`Expected count ${key} >= 1, got`, report.counts[key]);
    process.exit(1);
  }
}

console.log("import:validate OK", report.counts);
