DO $$ BEGIN
  CREATE TYPE "school_lineage_status" AS ENUM ('unknown', 'pass', 'warn', 'fail');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "school_assignment_materials" ADD COLUMN IF NOT EXISTS "strict_content_check" boolean DEFAULT false NOT NULL;

ALTER TABLE "school_submission_artifacts" ADD COLUMN IF NOT EXISTS "google_file_id" varchar(128);
ALTER TABLE "school_submission_artifacts" ADD COLUMN IF NOT EXISTS "google_mime_type" varchar(128);
ALTER TABLE "school_submission_artifacts" ADD COLUMN IF NOT EXISTS "google_revision_id" varchar(128);
ALTER TABLE "school_submission_artifacts" ADD COLUMN IF NOT EXISTS "material_id" uuid;
ALTER TABLE "school_submission_artifacts" ADD COLUMN IF NOT EXISTS "lineage_status" "school_lineage_status" DEFAULT 'unknown' NOT NULL;
ALTER TABLE "school_submission_artifacts" ADD COLUMN IF NOT EXISTS "lineage_detail" text;

DO $$ BEGIN
  ALTER TABLE "school_submission_artifacts" ADD CONSTRAINT "school_submission_artifacts_material_id_school_assignment_materials_id_fk"
    FOREIGN KEY ("material_id") REFERENCES "public"."school_assignment_materials"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "school_submission_google_copies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "material_id" uuid NOT NULL,
  "template_google_file_id" varchar(128) NOT NULL,
  "student_google_file_id" varchar(128) NOT NULL,
  "student_google_mime_type" varchar(128),
  "copied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" uuid
);

DO $$ BEGIN
  ALTER TABLE "school_submission_google_copies" ADD CONSTRAINT "school_submission_google_copies_submission_id_school_submissions_id_fk"
    FOREIGN KEY ("submission_id") REFERENCES "public"."school_submissions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "school_submission_google_copies" ADD CONSTRAINT "school_submission_google_copies_material_id_school_assignment_materials_id_fk"
    FOREIGN KEY ("material_id") REFERENCES "public"."school_assignment_materials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "school_submission_google_copies" ADD CONSTRAINT "school_submission_google_copies_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "school_submission_google_copies_submission_material" ON "school_submission_google_copies" USING btree ("submission_id","material_id");
