import {
  boolean,
  date,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
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
  visibility: assignmentVisibilityEnum("visibility").notNull().default("assigned"),
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
