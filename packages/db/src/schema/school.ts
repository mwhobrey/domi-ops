import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { driveObjects } from "./drive.js";
import { households, users } from "./household.js";

export const assignmentVisibilityEnum = pgEnum("assignment_visibility", [
  "draft",
  "assigned",
  "closed",
]);

export const submissionStatusEnum = pgEnum("submission_status", [
  "not_started",
  "submitted",
  "graded",
  "returned",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
  "late",
  "excused",
]);

export const schoolMaterialRoleEnum = pgEnum("school_material_role", [
  "student_material",
  "handout",
  "answer_key",
  "rubric",
  "reference",
]);

export const schoolMaterialSourceEnum = pgEnum("school_material_source", [
  "domi_drive_file",
  "domi_drive_link",
  "external_url",
  "google_doc",
]);

export const schoolLineageStatusEnum = pgEnum("school_lineage_status", [
  "unknown",
  "pass",
  "warn",
  "fail",
]);

export const schoolClasses = pgTable("school_classes", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 128 }).notNull(),
  subject: varchar("subject", { length: 128 }),
  term: varchar("term", { length: 64 }),
  teacherMemberId: uuid("teacher_member_id").notNull(),
  scheduleJson: text("schedule_json").default("{}"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolEnrollments = pgTable(
  "school_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => schoolClasses.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
    role: varchar("role", { length: 16 }).notNull().default("student"),
    activeFrom: date("active_from"),
    activeTo: date("active_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("school_enrollments_class_member").on(t.classId, t.memberId)],
);

export const schoolAssignmentCategories = pgTable("school_assignment_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id").references(() => schoolClasses.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 128 }).notNull(),
  weightPercent: real("weight_percent").notNull().default(0),
  gradingPolicy: varchar("grading_policy", { length: 32 }).notNull().default("points"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolAssignments = pgTable("school_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id")
    .notNull()
    .references(() => schoolClasses.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => schoolAssignmentCategories.id),
  title: varchar("title", { length: 256 }).notNull(),
  instructionsHtml: text("instructions_html").default(""),
  dueAt: timestamp("due_at", { withTimezone: true }),
  pointsPossible: real("points_possible").notNull().default(100),
  allowLate: boolean("allow_late").notNull().default(true),
  /** Null = unlimited turn-ins per student. */
  maxAttempts: integer("max_attempts"),
  visibility: assignmentVisibilityEnum("visibility").notNull().default("assigned"),
  /** One-shot Web Push reminder when due today or overdue (worker scan). */
  dueReminderSentAt: timestamp("due_reminder_sent_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolSubmissions = pgTable(
  "school_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => schoolAssignments.id, { onDelete: "cascade" }),
    studentMemberId: uuid("student_member_id").notNull(),
    status: submissionStatusEnum("status").notNull().default("not_started"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    isLate: boolean("is_late").notNull().default(false),
    attemptNumber: varchar("attempt_number", { length: 8 }).notNull().default("1"),
    studentNote: text("student_note").default(""),
    /** Incremented on each successful POST /submit for this student. */
    turnInCount: integer("turn_in_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("school_submissions_assignment_student_attempt").on(
      t.assignmentId,
      t.studentMemberId,
      t.attemptNumber,
    ),
  ],
);

export const schoolGrades = pgTable("school_grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => schoolSubmissions.id, { onDelete: "cascade" })
    .unique(),
  score: real("score"),
  feedbackHtml: text("feedback_html").default(""),
  gradedByUserId: uuid("graded_by_user_id").references(() => users.id),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
  revisionRequested: boolean("revision_requested").notNull().default(false),
});

export const schoolAssignmentMaterials = pgTable("school_assignment_materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => schoolAssignments.id, { onDelete: "cascade" }),
  role: schoolMaterialRoleEnum("role").notNull().default("handout"),
  source: schoolMaterialSourceEnum("source").notNull(),
  displayName: varchar("display_name", { length: 256 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  driveObjectId: uuid("drive_object_id").references(() => driveObjects.id, { onDelete: "set null" }),
  externalUrl: text("external_url"),
  googleFileId: varchar("google_file_id", { length: 128 }),
  googleMimeType: varchar("google_mime_type", { length: 128 }),
  googleRevisionId: varchar("google_revision_id", { length: 128 }),
  isTest: boolean("is_test").notNull().default(false),
  strictContentCheck: boolean("strict_content_check").notNull().default(false),
  studentVisible: boolean("student_visible").notNull().default(true),
  observerVisible: boolean("observer_visible").notNull().default(false),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  snapshotS3Key: text("snapshot_s3_key"),
  snapshotTextS3Key: text("snapshot_text_s3_key"),
  snapshotContentHash: varchar("snapshot_content_hash", { length: 64 }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolSubmissionArtifacts = pgTable("school_submission_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => schoolSubmissions.id, { onDelete: "cascade" }),
  artifactType: varchar("artifact_type", { length: 16 }).notNull(),
  s3Key: text("s3_key"),
  url: text("url"),
  note: text("note").default(""),
  googleFileId: varchar("google_file_id", { length: 128 }),
  googleMimeType: varchar("google_mime_type", { length: 128 }),
  googleRevisionId: varchar("google_revision_id", { length: 128 }),
  materialId: uuid("material_id").references(() => schoolAssignmentMaterials.id, {
    onDelete: "set null",
  }),
  lineageStatus: schoolLineageStatusEnum("lineage_status").notNull().default("unknown"),
  lineageDetail: text("lineage_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolSubmissionGoogleCopies = pgTable(
  "school_submission_google_copies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => schoolSubmissions.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => schoolAssignmentMaterials.id, { onDelete: "cascade" }),
    templateGoogleFileId: varchar("template_google_file_id", { length: 128 }).notNull(),
    studentGoogleFileId: varchar("student_google_file_id", { length: 128 }).notNull(),
    studentGoogleMimeType: varchar("student_google_mime_type", { length: 128 }),
    copiedAt: timestamp("copied_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
  },
  (t) => [
    uniqueIndex("school_submission_google_copies_submission_material").on(
      t.submissionId,
      t.materialId,
    ),
  ],
);

export const schoolAttendance = pgTable(
  "school_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id")
      .notNull()
      .references(() => schoolClasses.id, { onDelete: "cascade" }),
    studentMemberId: uuid("student_member_id").notNull(),
    attendanceDate: date("attendance_date").notNull(),
    status: attendanceStatusEnum("status").notNull().default("present"),
    note: text("note").default(""),
    markedByUserId: uuid("marked_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("school_attendance_class_student_date").on(
      t.classId,
      t.studentMemberId,
      t.attendanceDate,
    ),
  ],
);
