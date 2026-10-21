import { boolean, foreignKey, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { householdMembers, households, users } from "./household.js";
import { baSessions } from "./better-auth.js";
import { notes } from "./core.js";
import { oauthClient } from "./mcp-provider.js";

const time = (name: string) => timestamp(name, { withTimezone: true });

export const mcpHouseholdSettings = pgTable("mcp_household_settings", {
  householdId: uuid("household_id").primaryKey().references(() => households.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedByMemberId: uuid("updated_by_member_id").references(() => householdMembers.id, { onDelete: "set null" }),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const mcpConnections = pgTable("mcp_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => oauthClient.clientId),
  issuer: text("issuer").notNull(),
  resource: text("resource").notNull(),
  status: text("status").$type<"pending" | "active" | "revoked">().notNull().default("pending"),
  grantedRole: text("granted_role").notNull(),
  scopes: text("scopes").array().notNull(),
  policyVersion: text("policy_version").notNull(),
  clientProfileVersion: text("client_profile_version").notNull(),
  adultAttestedAt: time("adult_attested_at").notNull(),
  privacyAttestedAt: time("privacy_attested_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  activatedAt: time("activated_at"),
  expiresAt: time("expires_at").notNull(),
  revokedAt: time("revoked_at"),
}, (t) => [
  uniqueIndex("mcp_connections_household_id_id").on(t.householdId, t.id),
  uniqueIndex("mcp_connections_owner_identity").on(t.householdId, t.id, t.userId),
  foreignKey({ columns: [t.householdId, t.memberId, t.userId], foreignColumns: [householdMembers.householdId, householdMembers.id, householdMembers.userId] }).onDelete("cascade"),
]);

export const mcpNoteSelections = pgTable("mcp_note_selections", {
  householdId: uuid("household_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  noteId: uuid("note_id").notNull(),
  selectedAt: time("selected_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.connectionId, t.noteId] }),
  foreignKey({ columns: [t.householdId, t.connectionId], foreignColumns: [mcpConnections.householdId, mcpConnections.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.householdId, t.noteId], foreignColumns: [notes.householdId, notes.id] }).onDelete("cascade"),
]);

export const mcpPendingConsents = pgTable("mcp_pending_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => baSessions.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  resource: text("resource").notNull(),
  queryHash: text("query_hash").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
  consumedAt: time("consumed_at"),
}, (t) => [
  uniqueIndex("mcp_pending_consents_query_session").on(t.sessionId, t.queryHash),
  foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade"),
]);

export const mcpAccessEvents = pgTable("mcp_access_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  outcome: text("outcome").notNull(),
  requestId: uuid("request_id").notNull(),
  durationMs: integer("duration_ms"),
  byteCount: integer("byte_count"),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.householdId, t.connectionId, t.actorUserId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade")]);

// Deployment-level allowlist, accessed only through the provider repository.
export const mcpClientProfiles = pgTable("mcp_client_profiles", {
  clientId: text("client_id").primaryKey().references(() => oauthClient.clientId, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  version: text("version").notNull(),
  dataMode: text("data_mode").$type<"synthetic" | "household">().notNull(),
  enabled: boolean("enabled").notNull().default(false),
});
