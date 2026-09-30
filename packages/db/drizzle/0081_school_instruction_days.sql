-- WHO-347: homeschool-friendly attendance. Homeschoolers don't take a per-class roll call; they
-- record which days school happened. One row = "this student had school on this day".
-- Days also count automatically from hours logged and from class attendance marked present/late.

CREATE TABLE IF NOT EXISTS "school_instruction_days" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "student_member_id" uuid NOT NULL,
  "day" date NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "school_instruction_days_student_day"
  ON "school_instruction_days" ("household_id", "student_member_id", "day");

ALTER TABLE "school_instruction_days" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "school_instruction_days";
CREATE POLICY household_isolation ON "school_instruction_days"
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

-- Days of instruction the household's state requires per school year (e.g. 180). Null = no target.
ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "school_days_target" integer;
