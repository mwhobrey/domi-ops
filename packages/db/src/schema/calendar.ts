import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { households, users } from "./household.js";

export const calendarVisibilityEnum = pgEnum("calendar_visibility", [
  "household",
  "private",
]);

export const eventSourceEnum = pgEnum("event_source", ["local", "google"]);

export const syncModeEnum = pgEnum("sync_mode", [
  "import_only",
  "manual",
  "bidirectional",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "synced",
  "pending",
  "conflict",
  "error",
]);

/** User-owned calendar lane (household or private) */
export const calendars = pgTable("calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  ownerUserId: uuid("owner_user_id").references(() => users.id),
  name: varchar("name", { length: 128 }).notNull(),
  color: varchar("color", { length: 16 }),
  visibility: calendarVisibilityEnum("visibility").notNull().default("private"),
  isHouseholdDefault: boolean("is_household_default").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calendarShares = pgTable(
  "calendar_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    granteeUserId: uuid("grantee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canWrite: boolean("can_write").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendar_shares_cal_grantee").on(t.calendarId, t.granteeUserId)],
);

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  calendarId: uuid("calendar_id")
    .notNull()
    .references(() => calendars.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  categoryKey: varchar("category_key", { length: 64 }),
  color: varchar("color", { length: 16 }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  startTime: time("start_time"),
  endTime: time("end_time"),
  timeZone: varchar("time_zone", { length: 64 }),
  allDay: boolean("all_day").notNull().default(false),
  source: eventSourceEnum("source").notNull().default("local"),
  syncStatus: syncStatusEnum("sync_status").notNull().default("synced"),
  recurringRuleId: uuid("recurring_rule_id"),
  googleEventId: varchar("google_event_id", { length: 256 }),
  googleRecurringEventId: varchar("google_recurring_event_id", { length: 256 }),
  googleEtag: varchar("google_etag", { length: 128 }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recurringRules = pgTable("recurring_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  calendarId: uuid("calendar_id")
    .notNull()
    .references(() => calendars.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  rrule: text("rrule").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  categoryKey: varchar("category_key", { length: 64 }),
  color: varchar("color", { length: 16 }),
  lastGeneratedDate: date("last_generated_date"),
  googleRecurringEventId: varchar("google_recurring_event_id", { length: 256 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Google OAuth connection per user */
export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessTokenEnc: text("access_token_enc"),
  tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
  syncMode: syncModeEnum("sync_mode").notNull().default("import_only"),
  timeZone: varchar("time_zone", { length: 64 }).default("UTC"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
});

export const linkedGoogleCalendars = pgTable("linked_google_calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => calendarConnections.id, { onDelete: "cascade" }),
  googleCalendarId: varchar("google_calendar_id", { length: 256 }).notNull(),
  summary: varchar("summary", { length: 256 }),
  backgroundColor: varchar("background_color", { length: 32 }),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  syncToken: text("sync_token"),
  targetCalendarId: uuid("target_calendar_id").references(() => calendars.id),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
});

export const calendarSyncOutbox = pgTable("calendar_sync_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").references(() => calendarEvents.id, { onDelete: "cascade" }),
  operation: varchar("operation", { length: 16 }).notNull(),
  payloadJson: text("payload_json"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
