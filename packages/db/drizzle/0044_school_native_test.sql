DO $$ BEGIN
  ALTER TYPE "school_material_source" ADD VALUE 'native_test';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "school_native_test_points_mode" AS ENUM ('explicit', 'weighted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "school_question_type" AS ENUM (
    'multiple_choice',
    'multiple_choice_multi',
    'true_false',
    'short_answer',
    'long_answer'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "school_assignment_materials" ADD COLUMN IF NOT EXISTS "snapshot_json_s3_key" text;
ALTER TABLE "school_assignment_materials" ADD COLUMN IF NOT EXISTS "native_test_points_mode" "school_native_test_points_mode";

CREATE TABLE IF NOT EXISTS "school_test_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "material_id" uuid NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "question_type" "school_question_type" NOT NULL,
  "prompt_markdown" text DEFAULT '' NOT NULL,
  "points" real,
  "weight" real,
  "options_json" jsonb,
  "correct_answer_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "school_test_questions" ADD CONSTRAINT "school_test_questions_material_id_school_assignment_materials_id_fk"
    FOREIGN KEY ("material_id") REFERENCES "public"."school_assignment_materials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "school_test_questions_material_sort" ON "school_test_questions" USING btree ("material_id","sort_order");
