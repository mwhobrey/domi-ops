import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { households, users } from "./household.js";

export const userNotifications = pgTable("user_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 256 }).notNull(),
  body: text("body").notNull(),
  url: varchar("url", { length: 512 }).notNull().default("/dashboard"),
  tag: varchar("tag", { length: 128 }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
