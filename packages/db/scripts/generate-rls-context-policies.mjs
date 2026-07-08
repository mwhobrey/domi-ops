#!/usr/bin/env node
/**
 * Generates packages/db/drizzle/0039_rls_context_policies.sql
 * Run: npm run generate:rls-context -w @domi-ops/db
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rlsPath = join(__dirname, "../drizzle/0038_rls_household_policies.sql");
const outPath = join(__dirname, "../drizzle/0039_rls_context_policies.sql");

const rlsSql = readFileSync(rlsPath, "utf8");
const tables = [...rlsSql.matchAll(/^ALTER TABLE (\w+) ENABLE ROW LEVEL SECURITY;/gm)].map(
  (m) => m[1],
);

if (tables.length === 0) {
  throw new Error(`No RLS tables found in ${rlsPath}`);
}

const workerExpr = `current_setting('app.worker_scan', true) = 'true'`;
const systemExpr = `current_setting('app.system_access', true) = 'true'`;
const userLookupExpr = `user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid`;

const lines = [
  "-- WHO-196: Supplemental RLS policies for auth lookup, bootstrap, and worker scans.",
  "-- OR-combined with household_isolation from 0038 (PERMISSIVE policies).",
  "",
  "-- Auth middleware: resolve household_members by user_id before tenant context.",
  "DROP POLICY IF EXISTS member_auth_lookup ON household_members;",
  "CREATE POLICY member_auth_lookup ON household_members",
  "  FOR SELECT",
  `  USING (${userLookupExpr});`,
  "",
  "-- Greenfield bootstrap / CLI (withSystemContext).",
  "DROP POLICY IF EXISTS system_bootstrap ON households;",
  "CREATE POLICY system_bootstrap ON households",
  "  FOR ALL",
  `  USING (${systemExpr})`,
  `  WITH CHECK (${systemExpr});`,
  "",
  "DROP POLICY IF EXISTS system_bootstrap ON household_members;",
  "CREATE POLICY system_bootstrap ON household_members",
  "  FOR ALL",
  `  USING (${systemExpr})`,
  `  WITH CHECK (${systemExpr});`,
  "",
  "-- Trusted worker cross-tenant scans (withWorkerScanContext).",
];

for (const table of tables) {
  lines.push(`DROP POLICY IF EXISTS worker_scan ON ${table};`);
  lines.push(`CREATE POLICY worker_scan ON ${table}`);
  lines.push("  FOR ALL");
  lines.push(`  USING (${workerExpr})`);
  lines.push(`  WITH CHECK (${workerExpr});`);
  lines.push("");
}

writeFileSync(outPath, lines.join("\n"));
console.log(`Wrote ${outPath} (${tables.length} worker_scan policies + auth/system)`);
