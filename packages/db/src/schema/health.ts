import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { households, householdMembers, users } from "./household.js";
import { noteVisibilityEnum } from "./core.js";

export const healthEventTypeEnum = pgEnum("health_event_type", [
  "sickness",
  "injury",
  "appointment",
  "symptom",
  "medication",
  "other",
]);

export const medScheduleKindEnum = pgEnum("med_schedule_kind", ["scheduled", "prn"]);

export const medLogStatusEnum = pgEnum("med_log_status", ["taken", "skipped", "missed"]);

export const healthEventDurationKindEnum = pgEnum("health_event_duration_kind", [
  "single_day",
  "ongoing",
]);

export const healthEvents = pgTable("health_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => householdMembers.id, { onDelete: "cascade" }),
  medicationId: uuid("medication_id"),
  type: healthEventTypeEnum("type").notNull().default("other"),
  title: text("title").notNull(),
  notes: text("notes"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationKind: healthEventDurationKindEnum("duration_kind").notNull().default("single_day"),
  visibility: noteVisibilityEnum("visibility").notNull().default("private"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const healthEventShares = pgTable(
  "health_event_shares",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => healthEvents.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.memberId] })],
);

export const healthMedications = pgTable("health_medications", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => householdMembers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dosage: text("dosage"),
  instructions: text("instructions"),
  scheduleKind: medScheduleKindEnum("schedule_kind").notNull().default("scheduled"),
  scheduleJson: text("schedule_json").default("{}"),
  reminderOffsetsJson: text("reminder_offsets_json").default("[0]"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  enabled: boolean("enabled").notNull().default(true),
  visibility: noteVisibilityEnum("visibility").notNull().default("private"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const healthMedicationShares = pgTable(
  "health_medication_shares",
  {
    medicationId: uuid("medication_id")
      .notNull()
      .references(() => healthMedications.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.medicationId, t.memberId] })],
);

/** Per-grantee segment ACL for a subject's health data (WHO-229). */
export const healthAclLevelEnum = pgEnum("health_acl_level", ["none", "read", "write"]);

export const healthMemberAcl = pgTable(
  "health_member_acl",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    subjectMemberId: uuid("subject_member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    granteeMemberId: uuid("grantee_member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    eventsAccess: healthAclLevelEnum("events_access").notNull().default("none"),
    medicationsAccess: healthAclLevelEnum("medications_access").notNull().default("none"),
    dosesAccess: healthAclLevelEnum("doses_access").notNull().default("none"),
    reportsAccess: healthAclLevelEnum("reports_access").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.subjectMemberId, t.granteeMemberId] })],
);

export const healthMedicationLogs = pgTable("health_medication_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  medicationId: uuid("medication_id")
    .notNull()
    .references(() => healthMedications.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: medLogStatusEnum("status").notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  loggedByUserId: uuid("logged_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  healthEventId: uuid("health_event_id").references(() => healthEvents.id, {
    onDelete: "set null",
  }),
});

export const healthMedReminderSent = pgTable(
  "health_med_reminder_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    medicationId: uuid("medication_id")
      .notNull()
      .references(() => healthMedications.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    offsetMinutes: integer("offset_minutes").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_med_reminder_sent_unique").on(
      t.medicationId,
      t.scheduledAt,
      t.offsetMinutes,
    ),
  ],
);
