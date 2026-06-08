import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { households, householdMembers, users } from "./household.js";

export const shoppingRecurring = pgTable("shopping_recurring", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  item: varchar("item", { length: 256 }).notNull(),
  tagsJson: text("tags_json").default("[]"),
  quantity: real("quantity"),
  unit: varchar("unit", { length: 32 }),
  notes: text("notes"),
  interval: varchar("interval", { length: 16 }).notNull().default("weekly"),
  nextAt: date("next_at").notNull(),
  enabled: boolean("enabled").notNull().default(true),
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

export const expenseBudgets = pgTable(
  "expense_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 64 }).notNull(),
    monthlyTarget: real("monthly_target").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("expense_budgets_household_category").on(t.householdId, t.category)],
);

export const expenseBudgetAlertSent = pgTable(
  "expense_budget_alert_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 64 }).notNull(),
    monthKey: varchar("month_key", { length: 7 }).notNull(),
    alertKind: varchar("alert_kind", { length: 16 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("expense_budget_alert_sent_unique").on(
      t.householdId,
      t.category,
      t.monthKey,
      t.alertKind,
    ),
  ],
);

export const shoppingTrips = pgTable("shopping_trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  clearedAt: timestamp("cleared_at", { withTimezone: true }).notNull().defaultNow(),
  tripTotal: real("trip_total"),
  receiptS3Key: text("receipt_s3_key"),
  expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
  itemCount: integer("item_count").notNull().default(0),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
});

export const shoppingTripItems = pgTable("shopping_trip_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id")
    .notNull()
    .references(() => shoppingTrips.id, { onDelete: "cascade" }),
  item: varchar("item", { length: 256 }).notNull(),
  tagsJson: text("tags_json").default("[]"),
  quantity: real("quantity"),
  unit: varchar("unit", { length: 32 }),
  notes: text("notes"),
  cost: real("cost"),
});

export const shoppingItems = pgTable("shopping_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  item: varchar("item", { length: 256 }).notNull(),
  checked: boolean("checked").notNull().default(false),
  quantity: real("quantity"),
  unit: varchar("unit", { length: 32 }),
  notes: text("notes"),
  cost: real("cost"),
  recurringId: uuid("recurring_id").references(() => shoppingRecurring.id, { onDelete: "set null" }),
  tagsJson: text("tags_json").default("[]"),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const choresRecurring = pgTable("chores_recurring", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  tagsJson: text("tags_json").default("[]"),
  priority: integer("priority").notNull().default(0),
  assigneeMemberId: uuid("assignee_member_id").references(() => householdMembers.id, {
    onDelete: "set null",
  }),
  interval: varchar("interval", { length: 16 }).notNull().default("weekly"),
  nextAt: date("next_at").notNull(),
  enabled: boolean("enabled").notNull().default(true),
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
  priority: integer("priority").notNull().default(0),
  assigneeMemberId: uuid("assignee_member_id").references(() => householdMembers.id, {
    onDelete: "set null",
  }),
  recurringId: uuid("recurring_id").references(() => choresRecurring.id, { onDelete: "set null" }),
  dueReminderSentAt: timestamp("due_reminder_sent_at", { withTimezone: true }),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const choreCompletions = pgTable("chore_completions", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  choreId: uuid("chore_id").references(() => chores.id, { onDelete: "set null" }),
  memberId: uuid("member_id").references(() => householdMembers.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  karmaEarned: integer("karma_earned").notNull().default(0),
  timing: varchar("timing", { length: 16 }).notNull(),
  daysLate: integer("days_late"),
});

export const choreMemberKarma = pgTable(
  "chore_member_karma",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    karmaPoints: integer("karma_points").notNull().default(0),
    currentStreak: integer("current_streak").notNull().default(0),
    bestStreak: integer("best_streak").notNull().default(0),
    redemptionQuestsCompleted: integer("redemption_quests_completed").notNull().default(0),
    lastCompletionDate: date("last_completion_date"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.householdId, t.memberId] }),
  }),
);

export const noteVisibilityEnum = pgEnum("note_visibility", ["household", "private"]);

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 256 }).notNull(),
  content: text("content").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  tagsJson: text("tags_json").default("[]"),
  visibility: noteVisibilityEnum("visibility").notNull().default("household"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const noteShares = pgTable(
  "note_shares",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.memberId] })],
);

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
