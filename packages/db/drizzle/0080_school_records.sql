-- WHO-347: homeschool records. Hours log (new) and per-class credits (for transcripts).
-- Attendance already has a table (school_attendance, 0000); it gets an API and UI, no schema change.

ALTER TABLE "school_classes" ADD COLUMN IF NOT EXISTS "credits" real DEFAULT 1 NOT NULL;

CREATE TABLE IF NOT EXISTS "school_hours_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "student_member_id" uuid NOT NULL,
  -- Optional: instruction time that isn't tied to a class (field trip, co-op, reading).
  "class_id" uuid REFERENCES "school_classes"("id") ON DELETE set null,
  "log_date" date NOT NULL,
  "minutes" integer NOT NULL CHECK ("minutes" > 0 AND "minutes" <= 1440),
  "activity" varchar(128) DEFAULT '' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "school_hours_log_student_date_idx"
  ON "school_hours_log" ("household_id", "student_member_id", "log_date");

-- RLS: same direct household_id policy as school_classes.
ALTER TABLE "school_hours_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "school_hours_log";
CREATE POLICY household_isolation ON "school_hours_log"
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
