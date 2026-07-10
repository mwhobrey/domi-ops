CREATE TYPE "public"."school_material_role" AS ENUM(
  'student_material',
  'handout',
  'answer_key',
  'rubric',
  'reference'
);

CREATE TYPE "public"."school_material_source" AS ENUM(
  'domi_drive_file',
  'domi_drive_link',
  'external_url',
  'google_doc'
);

ALTER TABLE "school_assignments" ADD COLUMN "max_attempts" integer;

ALTER TABLE "school_submissions" ADD COLUMN "turn_in_count" integer DEFAULT 0 NOT NULL;

CREATE TABLE "school_assignment_materials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assignment_id" uuid NOT NULL,
  "role" "school_material_role" DEFAULT 'handout' NOT NULL,
  "source" "school_material_source" NOT NULL,
  "display_name" varchar(256) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "drive_object_id" uuid,
  "external_url" text,
  "google_file_id" varchar(128),
  "google_mime_type" varchar(128),
  "google_revision_id" varchar(128),
  "is_test" boolean DEFAULT false NOT NULL,
  "student_visible" boolean DEFAULT true NOT NULL,
  "observer_visible" boolean DEFAULT false NOT NULL,
  "frozen_at" timestamp with time zone,
  "snapshot_s3_key" text,
  "snapshot_text_s3_key" text,
  "snapshot_content_hash" varchar(64),
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "school_assignment_materials"
  ADD CONSTRAINT "school_assignment_materials_assignment_id_school_assignments_id_fk"
  FOREIGN KEY ("assignment_id") REFERENCES "public"."school_assignments"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "school_assignment_materials"
  ADD CONSTRAINT "school_assignment_materials_drive_object_id_drive_objects_id_fk"
  FOREIGN KEY ("drive_object_id") REFERENCES "public"."drive_objects"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "school_assignment_materials"
  ADD CONSTRAINT "school_assignment_materials_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "school_assignment_materials_assignment_id_idx" ON "school_assignment_materials" ("assignment_id");
