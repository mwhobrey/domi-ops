CREATE TYPE "public"."deployment_tier" AS ENUM('self_host', 'hosted_starter', 'hosted_dedicated');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member', 'child', 'guest');--> statement-breakpoint
CREATE TYPE "public"."calendar_visibility" AS ENUM('household', 'private');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('local', 'google');--> statement-breakpoint
CREATE TYPE "public"."sync_mode" AS ENUM('import_only', 'manual', 'bidirectional');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('synced', 'pending', 'conflict', 'error');--> statement-breakpoint
CREATE TYPE "public"."assignment_visibility" AS ENUM('draft', 'assigned', 'closed');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('not_started', 'submitted', 'graded', 'returned');--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"legacy_display_name" varchar(64),
	"legacy_external_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"slug" varchar(64),
	"tier" "deployment_tier" DEFAULT 'self_host' NOT NULL,
	"dedicated_db_ref" varchar(256),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"modules_enabled" text DEFAULT '["core","school","calendar_sync"]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" varchar(128),
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token_enc" text,
	"token_expiry" timestamp with time zone,
	"sync_mode" "sync_mode" DEFAULT 'import_only' NOT NULL,
	"time_zone" varchar(64) DEFAULT 'UTC',
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"category_key" varchar(64),
	"color" varchar(16),
	"start_date" date NOT NULL,
	"end_date" date,
	"start_time" time,
	"end_time" time,
	"time_zone" varchar(64),
	"all_day" boolean DEFAULT false NOT NULL,
	"source" "event_source" DEFAULT 'local' NOT NULL,
	"sync_status" "sync_status" DEFAULT 'synced' NOT NULL,
	"recurring_rule_id" uuid,
	"google_event_id" varchar(256),
	"google_recurring_event_id" varchar(256),
	"google_etag" varchar(128),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"grantee_user_id" uuid NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"operation" varchar(16) NOT NULL,
	"payload_json" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"name" varchar(128) NOT NULL,
	"color" varchar(16),
	"visibility" "calendar_visibility" DEFAULT 'private' NOT NULL,
	"is_household_default" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linked_google_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"google_calendar_id" varchar(256) NOT NULL,
	"summary" varchar(256),
	"background_color" varchar(32),
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"sync_token" text,
	"target_calendar_id" uuid,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"rrule" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"category_key" varchar(64),
	"color" varchar(16),
	"last_generated_date" date,
	"google_recurring_event_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_assignment_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid,
	"name" varchar(128) NOT NULL,
	"weight_percent" real DEFAULT 0 NOT NULL,
	"grading_policy" varchar(32) DEFAULT 'points' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"category_id" uuid,
	"title" varchar(256) NOT NULL,
	"instructions_html" text DEFAULT '',
	"due_at" timestamp with time zone,
	"points_possible" real DEFAULT 100 NOT NULL,
	"allow_late" boolean DEFAULT true NOT NULL,
	"visibility" "assignment_visibility" DEFAULT 'assigned' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"student_member_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"status" "attendance_status" DEFAULT 'present' NOT NULL,
	"note" text DEFAULT '',
	"marked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"subject" varchar(128),
	"term" varchar(64),
	"teacher_member_id" uuid NOT NULL,
	"schedule_json" text DEFAULT '{}',
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'student' NOT NULL,
	"active_from" date,
	"active_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"score" real,
	"feedback_html" text DEFAULT '',
	"graded_by_user_id" uuid,
	"graded_at" timestamp with time zone,
	"revision_requested" boolean DEFAULT false NOT NULL,
	CONSTRAINT "school_grades_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "school_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_member_id" uuid NOT NULL,
	"status" "submission_status" DEFAULT 'not_started' NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_late" boolean DEFAULT false NOT NULL,
	"attempt_number" varchar(8) DEFAULT '1' NOT NULL,
	"student_note" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"source_system" varchar(32) DEFAULT 'homehub' NOT NULL,
	"source_table" varchar(64) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"target_table" varchar(64) NOT NULL,
	"target_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_outbox" ADD CONSTRAINT "calendar_sync_outbox_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_google_calendars" ADD CONSTRAINT "linked_google_calendars_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_google_calendars" ADD CONSTRAINT "linked_google_calendars_target_calendar_id_calendars_id_fk" FOREIGN KEY ("target_calendar_id") REFERENCES "public"."calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_assignment_categories" ADD CONSTRAINT "school_assignment_categories_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_assignments" ADD CONSTRAINT "school_assignments_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_assignments" ADD CONSTRAINT "school_assignments_category_id_school_assignment_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."school_assignment_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_assignments" ADD CONSTRAINT "school_assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_attendance" ADD CONSTRAINT "school_attendance_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_attendance" ADD CONSTRAINT "school_attendance_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_enrollments" ADD CONSTRAINT "school_enrollments_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_grades" ADD CONSTRAINT "school_grades_submission_id_school_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."school_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_grades" ADD CONSTRAINT "school_grades_graded_by_user_id_users_id_fk" FOREIGN KEY ("graded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_submissions" ADD CONSTRAINT "school_submissions_assignment_id_school_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."school_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_household_user" ON "household_members" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_shares_cal_grantee" ON "calendar_shares" USING btree ("calendar_id","grantee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_attendance_class_student_date" ON "school_attendance" USING btree ("class_id","student_member_id","attendance_date");--> statement-breakpoint
CREATE UNIQUE INDEX "school_enrollments_class_member" ON "school_enrollments" USING btree ("class_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_submissions_assignment_student_attempt" ON "school_submissions" USING btree ("assignment_id","student_member_id","attempt_number");