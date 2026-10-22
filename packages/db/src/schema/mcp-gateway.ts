import { boolean, foreignKey, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { households } from "./household.js";
import { mcpConnections } from "./mcp.js";

const bucket = () => timestamp("bucket", { withTimezone: true }).notNull();
export const mcpHouseholdWindows = pgTable("mcp_household_windows", {
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  bucket: bucket(), calls: integer("calls").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.householdId, t.bucket] })]);

export const mcpConnectionWindows = pgTable("mcp_connection_windows", {
  householdId: uuid("household_id").notNull(), userId: uuid("user_id").notNull(), connectionId: uuid("connection_id").notNull(),
  bucket: bucket(), calls: integer("calls").notNull().default(0), throttled: boolean("throttled").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.connectionId, t.bucket] }),
  foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade")]);

export const mcpRequestLeases = pgTable("mcp_request_leases", {
  id: uuid("id").primaryKey(), householdId: uuid("household_id").notNull(), userId: uuid("user_id").notNull(), connectionId: uuid("connection_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [foreignKey({ columns: [t.householdId, t.connectionId, t.userId], foreignColumns: [mcpConnections.householdId, mcpConnections.id, mcpConnections.userId] }).onDelete("cascade")]);
