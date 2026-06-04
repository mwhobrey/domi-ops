import {
  boolean,
  date,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { households, householdMembers, users } from "./household.js";

export const shoppingItems = pgTable("shopping_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  item: varchar("item", { length: 256 }).notNull(),
  checked: boolean("checked").notNull().default(false),
  tagsJson: text("tags_json").default("[]"),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chores = pgTable("chores", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  done: boolean("done").notNull().default(false),
  dueDate: date("due_date"),
  tagsJson: text("tags_json").default("[]"),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 256 }).notNull(),
  amount: real("amount").notNull().default(0),
  category: varchar("category", { length: 64 }),
  expenseDate: date("expense_date").notNull(),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notices = pgTable("notices", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  postedByUserId: uuid("posted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByDisplayName: varchar("updated_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const noticeReads = pgTable(
  "notice_reads",
  {
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notice_reads_notice_user").on(t.noticeId, t.userId)],
);

export const homeStatus = pgTable(
  "home_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => householdMembers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    presence: varchar("presence", { length: 8 }).notNull().default("Away"),
    statusMessage: varchar("status_message", { length: 64 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("home_status_household_member").on(t.householdId, t.memberId)],
);
