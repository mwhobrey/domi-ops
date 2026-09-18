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
  "exercise",
  "pain",
  "food_intake",
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

/**
 * Front/back body-map regions for pain logging (WHO-297/298). Shoulders, arms, hands, thighs,
 * shins, and feet are clickable from either view and share one region value; only anatomically
 * front- or back-only areas (head/face, neck, torso, buttocks) get separate front/back entries.
 */
export const healthPainBodyRegionEnum = pgEnum("health_pain_body_region", [
  "front_head",
  "face",
  "neck_front",
  "chest",
  "abdomen",
  "groin",
  "left_shoulder",
  "right_shoulder",
  "left_upper_arm",
  "right_upper_arm",
  "left_forearm",
  "right_forearm",
  "left_hand",
  "right_hand",
  "left_thigh",
  "right_thigh",
  "left_shin",
  "right_shin",
  "left_foot",
  "right_foot",
  "back_head",
  "neck_back",
  "upper_back",
  "lower_back",
  "buttocks",
  "left_shoulder_blade",
  "right_shoulder_blade",
  "left_hamstring",
  "right_hamstring",
  "left_calf",
  "right_calf",
  // WHO-312 (0070). "chest" above is legacy — kept so old logs stay valid, no longer selectable.
  "left_chest",
  "right_chest",
  "spine",
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

/**
 * One or more activities logged against a `type: "exercise"` health_events row — a single
 * "Morning workout" event can carry several rows (e.g. running + strength training), same
 * one-event-many-rows shape as health_vitals_readings. Quantitative fields are encrypted text
 * (same convention as vitals `value`); `intensity`, `distance_unit`, and the reserved
 * `external_*` import-dedupe columns are plain, non-PHI metadata.
 */
export const healthExerciseDetails = pgTable("health_exercise_details", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => healthEvents.id, { onDelete: "cascade" }),
  activity: text("activity").notNull(),
  durationMinutes: text("duration_minutes"),
  intensity: text("intensity"),
  distance: text("distance"),
  distanceUnit: text("distance_unit"),
  sets: text("sets"),
  reps: text("reps"),
  caloriesEstimated: text("calories_estimated"),
  /** Reserved for a future Apple Health / Google Fit import — unused until that ships. */
  externalSource: text("external_source").notNull().default("manual"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One or more body-region check-ins logged against a `type: "pain"` health_events row —
 * tapping a front/back body map is inherently multi-select, so "headache 6/10 + neck
 * stiffness 4/10" logged together is two rows sharing one eventId. `severity` and
 * `qualityTags` are encrypted text (same convention as vitals `value` / event `notes`);
 * `bodyRegion` is a plain enum, same treatment as vitals' `metric`.
 */
export const healthPainLogs = pgTable("health_pain_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => healthEvents.id, { onDelete: "cascade" }),
  bodyRegion: healthPainBodyRegionEnum("body_region").notNull(),
  severity: text("severity").notNull(),
  qualityTags: text("quality_tags"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One or more food items logged against a `type: "food_intake"` health_events row — a meal
 * naturally has several items in one sitting, same one-event-many-rows shape as
 * health_vitals_readings/health_exercise_details. Quantitative fields are encrypted text (same
 * convention as vitals `value`); `unit` and `source` are plain, non-PHI metadata. `source` is
 * reserved for a future food-database/lookup integration the same way
 * health_exercise_details.external_source is — manual entry only for v1.
 */
export const healthFoodLogEntries = pgTable("health_food_log_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => healthEvents.id, { onDelete: "cascade" }),
  foodName: text("food_name").notNull(),
  quantity: text("quantity").notNull(),
  unit: text("unit").notNull(),
  calories: text("calories"),
  proteinG: text("protein_g"),
  carbsG: text("carbs_g"),
  fatG: text("fat_g"),
  source: text("source").notNull().default("manual"),
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
 *
 * Membership is many-to-many (healthMedicationGroupMembers below), not a column on
 * healthMedications — a medication taken multiple times a day can have different doses belong
 * to different groups (e.g. an 8am dose in "Morning meds", an 8pm dose in "Evening meds").
 * For scheduled-kind groups, a member medication's dose at time T only gets consolidated into
 * this group's reminder when T is in BOTH the group's own times and that medication's own
 * times — a medication merely listed as a "member" doesn't imply every one of its doses is
 * covered, only the ones whose time actually matches. For interval-kind groups there's no
 * discrete time to match against, so membership there works the simpler way it always did:
 * the medication's whole interval schedule delegates to the group.
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

/** Many-to-many: a medication can belong to several groups (see healthMedicationGroups doc). */
export const healthMedicationGroupMembers = pgTable(
  "health_medication_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => healthMedicationGroups.id, { onDelete: "cascade" }),
    medicationId: uuid("medication_id")
      .notNull()
      .references(() => healthMedications.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.medicationId] })],
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

export const healthMedicationLogs = pgTable(
  "health_medication_logs",
  {
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
  },
  (t) => [
    // One log per medication per scheduled instant — the DB backstop behind recordDose()
    // (apps/api/src/lib/health-med-logging.ts). PRN doses (scheduled_at NULL) are exempt:
    // "as needed" means many per day, each its own row.
    uniqueIndex("health_medication_logs_instant_unique")
      .on(t.medicationId, t.scheduledAt)
      .where(sql`${t.scheduledAt} is not null`),
  ],
);

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
