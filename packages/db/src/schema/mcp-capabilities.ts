import { boolean, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { calendars } from "./calendar.js";
import { healthMedicationGroups } from "./health.js";
import { mcpConnections } from "./mcp.js";

/** What a member switched on for one connection. A granted scope with no row here authorizes nothing. */
export const mcpConnectionCapabilities = pgTable("mcp_connection_capabilities", {
  householdId: uuid("household_id").notNull(), connectionId: uuid("connection_id").notNull(), userId: uuid("user_id").notNull(),
  capability: text("capability").notNull(), detailLevel: text("detail_level"), consentVersion: text("consent_version").notNull(),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.connectionId, t.capability] }),
  foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade"),
]);

/** Member-visible record of a completed assistant action. Outcome classes and counts only. */
export const mcpActionEvents = pgTable("mcp_action_events", {
  id: uuid("id").primaryKey().defaultRandom(), householdId: uuid("household_id").notNull(), userId: uuid("user_id").notNull(),
  connectionId: uuid("connection_id").notNull(), action: text("action").notNull(), outcome: text("outcome").notNull(),
  counts: jsonb("counts").$type<Record<string, number>>(), targetId: uuid("target_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("mcp_action_events_connection_idx").on(t.connectionId, t.createdAt),
  index("mcp_action_events_retention_idx").on(t.createdAt),
  foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade"),
]);

/** A medication group one connection may see as a label, its times and its logging status. */
export const mcpMedGroupSelections = pgTable("mcp_med_group_selections", {
  householdId: uuid("household_id").notNull(), connectionId: uuid("connection_id").notNull(), userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull().references(() => healthMedicationGroups.id, { onDelete: "cascade" }),
  canLog: boolean("can_log").notNull().default(false), shareCounts: boolean("share_counts").notNull().default(true),
  labelAlias: text("label_alias"), consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.connectionId, t.groupId] }),
  foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade"),
]);

/** Per-medication approval inside a selected group. No row means added after consent: not approved. */
export const mcpMedGroupMemberConsents = pgTable("mcp_med_group_member_consents", {
  householdId: uuid("household_id").notNull(), connectionId: uuid("connection_id").notNull(), userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(), medicationId: uuid("medication_id").notNull(),
  state: text("state").$type<"approved" | "excluded">().notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.connectionId, t.groupId, t.medicationId] }),
  index("mcp_med_group_member_consents_member_idx").on(t.groupId, t.medicationId),
  foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade"),
]);

/** A calendar one connection may read busy time from. Its name and events never leave. */
export const mcpCalendarSelections = pgTable("mcp_calendar_selections", {
  householdId: uuid("household_id").notNull(), connectionId: uuid("connection_id").notNull(), userId: uuid("user_id").notNull(),
  calendarId: uuid("calendar_id").notNull().references(() => calendars.id, { onDelete: "cascade" }),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.connectionId, t.calendarId] }),
  foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade"),
]);
