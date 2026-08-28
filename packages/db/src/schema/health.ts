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
import { sql } from "drizzle-orm";
import { households, householdMembers, users } from "./household.js";
import { pushSubscriptions } from "./push.js";
import { noteVisibilityEnum } from "./core.js";

export const healthEventTypeEnum = pgEnum("health_event_type", [
  "sickness",
  "injury",
  "appointment",
  "symptom",
  "medication",
  "vitals",
  "other",
]);

export const healthVitalsMetricEnum = pgEnum("health_vitals_metric", [
  "weight",
  "height",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "heart_rate",
  "temperature",
  "blood_oxygen",
  "blood_glucose",
  "respiratory_rate",
  "other",
]);

export const medScheduleKindEnum = pgEnum("med_schedule_kind", [
  "scheduled",
  "prn",
  "interval",
]);

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

/**
 * One row per numeric reading on a `type: "vitals"` health_events row — a single vitals
 * check-in (e.g. "Morning vitals") can log several (weight + BP systolic + BP diastolic +
 * heart rate) as separate rows sharing one eventId. `value` is encrypted text (same
 * house convention as title/notes/name/dosage — see health-crypto.ts), parsed back to a
 * number after decryption for reports; `unit` is plain text, not PHI.
 */
export const healthVitalsReadings = pgTable("health_vitals_readings", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => healthEvents.id, { onDelete: "cascade" }),
  metric: healthVitalsMetricEnum("metric").notNull(),
  value: text("value").notNull(),
  unit: text("unit").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  /**
   * When set, this medication's own schedule fields above are preserved-but-inert — the
   * reminder worker skips it entirely and evaluates the group's schedule instead. Removing
   * it from the group (or the group being deleted, via ON DELETE SET NULL) restores its
   * standalone schedule with no data loss.
   */
  groupId: uuid("group_id").references(() => healthMedicationGroups.id, { onDelete: "set null" }),
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

/**
 * A user-configured bundle of medications that share one schedule, so recipients get a single
 * consolidated reminder instead of one per medication (WHO-medgroups). Same schedule shape as
 * healthMedications ("prn" is rejected at the API layer — a PRN group has no shared due time to
 * consolidate around). Scoped to a single member, mirroring healthMedications and the existing
 * per-member ACL/recipient-resolution code.
 */
export const healthMedicationGroups = pgTable("health_medication_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => householdMembers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
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

export const healthMedicationGroupShares = pgTable(
  "health_medication_group_shares",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => healthMedicationGroups.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.memberId] })],
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
    /** Null = inbox-only / no push endpoint; set per device for WHO-233. */
    subscriptionId: uuid("subscription_id").references(() => pushSubscriptions.id, {
      onDelete: "cascade",
    }),
    /** Recipient user for inbox-only dedupe across subject + dose admins (WHO-238). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_med_reminder_sent_sub_unique")
      .on(t.medicationId, t.scheduledAt, t.offsetMinutes, t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    uniqueIndex("health_med_reminder_sent_nosub_unique")
      .on(t.medicationId, t.scheduledAt, t.offsetMinutes, t.userId)
      .where(sql`${t.subscriptionId} is null`),
  ],
);

/** Same dedupe/idempotency shape as healthMedReminderSent, keyed by group instead of medication. */
export const healthMedGroupReminderSent = pgTable(
  "health_med_group_reminder_sent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => healthMedicationGroups.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    offsetMinutes: integer("offset_minutes").notNull(),
    subscriptionId: uuid("subscription_id").references(() => pushSubscriptions.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_med_group_reminder_sent_sub_unique")
      .on(t.groupId, t.scheduledAt, t.offsetMinutes, t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    uniqueIndex("health_med_group_reminder_sent_nosub_unique")
      .on(t.groupId, t.scheduledAt, t.offsetMinutes, t.userId)
      .where(sql`${t.subscriptionId} is null`),
  ],
);
