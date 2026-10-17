import { bigint, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { householdMembers, households } from "./household.js";

/** Server-owned provenance for browser uploads. Storage keys are never authorization. */
export const browserUploads = pgTable("browser_uploads", {
  id: uuid("id").primaryKey(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").references(() => householdMembers.id, { onDelete: "set null" }),
  purpose: text("purpose").notNull(),
  s3Key: text("s3_key").notNull(),
  contentType: text("content_type").notNull(),
  maxBytes: bigint("max_bytes", { mode: "number" }).notNull(),
  byteSize: bigint("byte_size", { mode: "number" }),
  state: text("state").notNull().default("issued"),
  claimedBy: text("claimed_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("browser_uploads_s3_key").on(t.s3Key)]);
