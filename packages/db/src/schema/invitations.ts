import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { householdMembers, households, memberRoleEnum, users } from "./household.js";
export const householdInvitations = pgTable("household_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: memberRoleEnum("role").notNull().default("member"),
  tokenHash: text("token_hash").notNull(),
  createdByMemberId: uuid("created_by_member_id").references(() => householdMembers.id, { onDelete: "set null" }),
  acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("household_invitations_token_hash").on(t.tokenHash)]);
