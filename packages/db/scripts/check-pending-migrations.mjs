#!/usr/bin/env node
// Read-only pending-migrations gate for hosted deploys (deploy/deploy-hosted.sh).
//
// Hosted's running app connects as the restricted `domi_ops_app` role (NOBYPASSRLS, no DDL
// grants — packages/db/scripts/create-hosted-app-role.mjs), so it can never apply a migration
// itself; that's a required separate step against the ADMIN connection string before any
// deploy that ships one (deploy/HOSTED_BETA_SETUP.md). This script replaces "hope someone
// remembered" with an actual check: it reproduces drizzle-orm's own pending-migration logic
// (pg-core/dialect.js `migrate()` — compare the newest `created_at` in
// "drizzle"."__drizzle_migrations" against each local migration file's journal timestamp)
// using only a SELECT, which the restricted role already has. Exits non-zero if anything is
// pending, so the deploy script can abort before touching containers.
//
// Usage: DATABASE_URL=<connection string> node check-pending-migrations.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const journalPath = path.join(scriptDir, "..", "drizzle", "meta", "_journal.json");

let journal;
try {
  journal = JSON.parse(readFileSync(journalPath, "utf8"));
} catch (err) {
  console.error(`Couldn't read local migration journal at ${journalPath}: ${err.message}`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });

try {
  let lastAppliedAt = null;
  try {
    const rows = await sql`
      select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1
    `;
    lastAppliedAt = rows[0] ? Number(rows[0].created_at) : null;
  } catch (err) {
    // Matches drizzle-orm's own behavior: no schema/table yet means every local migration is
    // pending, not an error. Only re-throw if it's something other than "doesn't exist" (42P01
    // undefined_table) — a real permission/connection problem should still fail loud.
    if (err.code !== "42P01") throw err;
  }

  const pending = journal.entries.filter((entry) => lastAppliedAt === null || entry.when > lastAppliedAt);

  if (pending.length === 0) {
    console.log(`OK: all ${journal.entries.length} local migrations already applied.`);
    process.exit(0);
  }

  console.error(
    `BLOCKED: ${pending.length} local migration(s) not yet applied to this database:\n` +
      pending.map((e) => `  - ${e.tag}`).join("\n") +
      `\n\nApply them via the ADMIN connection string first, from a machine with this repo checked out:\n` +
      `    DATABASE_URL="<DO admin connection string>" npm run db:migrate\n` +
      `then re-run the deploy.`,
  );
  process.exit(1);
} finally {
  await sql.end();
}
