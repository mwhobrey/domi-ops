import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Opt-in, anonymized metrics — never linked to households/users. No household_id, no
 * userId, no FK back into tenant data anywhere in this file; that's the anonymization
 * guarantee, not just a convention. Collected from both self-host (opt-in per install,
 * POSTs to a configurable central collector — defaults to https://app.domi-ops.com) and
 * hosted (same opt-in toggle, same endpoint, already local). See docs/TELEMETRY.md.
 *
 * Not RLS-protected — matches stripe_events (0054): no household_id column, nothing to
 * scope by. Deliberately its own schema file, not folded into household.ts, so "does this
 * table have a household_id" stays a one-glance answer.
 */

export const telemetryEventKindEnum = pgEnum("telemetry_event_kind", [
  "web_vital",
  "error",
  "usage",
]);

export const telemetryEvents = pgTable("telemetry_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Random UUID generated client-side on first opt-in, stored in localStorage. Not derived
   * from any user/household identifier — purely a de-dup/session-correlation handle. */
  anonId: uuid("anon_id").notNull(),
  kind: telemetryEventKindEnum("kind").notNull(),
  /** Web vital name (LCP/CLS/INP/...), error message (truncated), or usage event name
   * (fixed taxonomy, e.g. "chore.completed") — never free text, never record content. */
  name: varchar("name", { length: 256 }).notNull(),
  value: integer("value"),
  /** Route path only (e.g. "/health/reports") — never a full URL, never a query string. */
  path: varchar("path", { length: 256 }),
  deploymentMode: varchar("deployment_mode", { length: 16 }),
  appVersion: varchar("app_version", { length: 32 }),
  /** Small structured extra fields only (e.g. { rating: "good" }) — never free text. */
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Explicit, user-authored — NOT gated by the telemetryOptIn toggle. Submitting a bug
 * report is its own one-time consent for that one message, separate from passive
 * background metrics. `email` is optional and only used to follow up on that report.
 */
export const telemetryBugReports = pgTable("telemetry_bug_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  anonId: uuid("anon_id").notNull(),
  message: text("message").notNull(),
  email: varchar("email", { length: 320 }),
  deploymentMode: varchar("deployment_mode", { length: 16 }),
  appVersion: varchar("app_version", { length: 32 }),
  path: varchar("path", { length: 256 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
