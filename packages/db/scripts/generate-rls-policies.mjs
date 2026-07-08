#!/usr/bin/env node
/**
 * Generates packages/db/drizzle/0038_rls_household_policies.sql
 * Run: node packages/db/scripts/generate-rls-policies.mjs
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../drizzle/0038_rls_household_policies.sql");

const tenantExpr = `NULLIF(current_setting('app.current_household_id', true), '')::uuid`;

/** Tables with a household_id column */
const directHouseholdId = [
  "household_members",
  "household_subscriptions",
  "import_records",
  "calendars",
  "calendar_events",
  "event_categories",
  "calendar_event_reminders",
  "recurring_rules",
  "calendar_connections",
  "shopping_recurring",
  "expenses",
  "expense_budgets",
  "expense_budget_alert_sent",
  "shopping_trips",
  "shopping_items",
  "chores_recurring",
  "chores",
  "chore_completions",
  "chore_member_karma",
  "notes",
  "notices",
  "home_status",
  "drive_folders",
  "drive_objects",
  "google_docs_connections",
  "health_events",
  "health_medications",
  "user_notifications",
  "school_classes",
];

/** table -> SQL expression that must be true for row access */
const indirect = [
  ["calendar_shares", `EXISTS (SELECT 1 FROM calendars p WHERE p.id = calendar_shares.calendar_id AND p.household_id = ${tenantExpr})`],
  [
    "linked_google_calendars",
    `EXISTS (SELECT 1 FROM calendar_connections p WHERE p.id = linked_google_calendars.connection_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "calendar_category_import_mappings",
    `EXISTS (SELECT 1 FROM calendar_connections p WHERE p.id = calendar_category_import_mappings.connection_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "calendar_sync_outbox",
    `EXISTS (SELECT 1 FROM calendar_events p WHERE p.id = calendar_sync_outbox.event_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "school_enrollments",
    `EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_enrollments.class_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "school_assignment_categories",
    `EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_assignment_categories.class_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "school_assignments",
    `EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_assignments.class_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "school_submissions",
    `EXISTS (
      SELECT 1 FROM school_assignments a
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE a.id = school_submissions.assignment_id AND p.household_id = ${tenantExpr}
    )`,
  ],
  [
    "school_grades",
    `EXISTS (
      SELECT 1 FROM school_submissions s
      INNER JOIN school_assignments a ON a.id = s.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE s.id = school_grades.submission_id AND p.household_id = ${tenantExpr}
    )`,
  ],
  [
    "school_submission_artifacts",
    `EXISTS (
      SELECT 1 FROM school_submissions s
      INNER JOIN school_assignments a ON a.id = s.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE s.id = school_submission_artifacts.submission_id AND p.household_id = ${tenantExpr}
    )`,
  ],
  [
    "school_attendance",
    `EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_attendance.class_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "drive_shares",
    `EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_shares.drive_object_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "drive_references",
    `EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_references.drive_object_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "drive_share_tokens",
    `EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_share_tokens.drive_object_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "note_shares",
    `EXISTS (SELECT 1 FROM notes p WHERE p.id = note_shares.note_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "notice_reads",
    `EXISTS (SELECT 1 FROM notices p WHERE p.id = notice_reads.notice_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "shopping_trip_items",
    `EXISTS (SELECT 1 FROM shopping_trips p WHERE p.id = shopping_trip_items.trip_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "health_event_shares",
    `EXISTS (SELECT 1 FROM health_events p WHERE p.id = health_event_shares.event_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "health_medication_shares",
    `EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_shares.medication_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "health_medication_logs",
    `EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_logs.medication_id AND p.household_id = ${tenantExpr})`,
  ],
  [
    "health_med_reminder_sent",
    `EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_med_reminder_sent.medication_id AND p.household_id = ${tenantExpr})`,
  ],
];

const lines = [
  "-- WHO-195: Row Level Security for Hosted Starter (DEPLOYMENT_MODE=shared)",
  "-- Requires SET LOCAL app.current_household_id = '<uuid>' per transaction (WHO-196).",
  "-- Excluded (auth / global identity): users, ba_sessions, ba_accounts, ba_verifications,",
  "--   auth_sessions, oauth_accounts, push_subscriptions — API-scoped; revisit in WHO-197.",
  "-- Superuser / BYPASSRLS roles (migrations) bypass RLS. Production app role must NOT bypass.",
  "",
  "CREATE SCHEMA IF NOT EXISTS app;",
  "",
  "CREATE OR REPLACE FUNCTION app.tenant_household_id()",
  "RETURNS uuid",
  "LANGUAGE sql",
  "STABLE",
  "AS $$",
  "  SELECT NULLIF(current_setting('app.current_household_id', true), '')::uuid;",
  "$$;",
  "",
  "-- households: tenant row is the household itself",
  "ALTER TABLE households ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS household_isolation ON households;",
  "CREATE POLICY household_isolation ON households",
  "  FOR ALL",
  `  USING (id = ${tenantExpr})`,
  `  WITH CHECK (id = ${tenantExpr});`,
  "",
];

for (const table of directHouseholdId) {
  lines.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
  lines.push(`DROP POLICY IF EXISTS household_isolation ON ${table};`);
  lines.push(`CREATE POLICY household_isolation ON ${table}`);
  lines.push("  FOR ALL");
  lines.push(`  USING (household_id = ${tenantExpr})`);
  lines.push(`  WITH CHECK (household_id = ${tenantExpr});`);
  lines.push("");
}

for (const [table, expr] of indirect) {
  lines.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
  lines.push(`DROP POLICY IF EXISTS household_isolation ON ${table};`);
  lines.push(`CREATE POLICY household_isolation ON ${table}`);
  lines.push("  FOR ALL");
  lines.push(`  USING (${expr})`);
  lines.push(`  WITH CHECK (${expr});`);
  lines.push("");
}

writeFileSync(outPath, lines.join("\n"));
console.log(`Wrote ${outPath} (${directHouseholdId.length + indirect.length + 1} tables)`);
