import { foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { mcpConnections } from "./mcp.js";

export const mcpWriteIntents = pgTable("mcp_write_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull(), userId: uuid("user_id").notNull(), memberId: uuid("member_id").notNull(),
  connectionId: uuid("connection_id").notNull(), clientId: text("client_id").notNull(),
  operation: text("operation").notNull(), operationVersion: text("operation_version").notNull(), scope: text("scope").notNull(),
  policyVersion: text("policy_version").notNull(), profileVersion: text("profile_version").notNull(), grantedRole: text("granted_role").notNull(),
  keyHash: text("key_hash").notNull(), requestDigest: text("request_digest").notNull(), previewDigest: text("preview_digest").notNull(),
  envelope: text("envelope"), state: text("state").$type<"pending" | "committed" | "rejected" | "stale" | "expired">().notNull().default("pending"),
  reviewSessionHash: text("review_session_hash"), reviewNonceHash: text("review_nonce_hash"),
  receiptId: uuid("receipt_id"), confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("mcp_write_intent_key").on(t.connectionId, t.keyHash),
  uniqueIndex("mcp_write_intent_owner").on(t.householdId, t.id, t.userId, t.connectionId),
  index("mcp_write_intent_expiry").on(t.expiresAt),
  foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade"),
]);

export const mcpWriteEvents = pgTable("mcp_write_events", {
  id: uuid("id").primaryKey().defaultRandom(), householdId: uuid("household_id").notNull(), userId: uuid("user_id").notNull(),
  connectionId: uuid("connection_id").notNull(), intentId: uuid("intent_id").notNull(),
  outcome: text("outcome").notNull(), sessionHash: text("session_hash"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("mcp_write_event_intent").on(t.intentId),
  foreignKey({ columns: [t.householdId, t.intentId, t.userId, t.connectionId], foreignColumns: [mcpWriteIntents.householdId, mcpWriteIntents.id, mcpWriteIntents.userId, mcpWriteIntents.connectionId] }).onDelete("cascade"),
]);
