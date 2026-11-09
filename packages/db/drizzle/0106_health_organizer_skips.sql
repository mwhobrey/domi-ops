-- A scheduled pill can be kept out of the organizer for good (organizer_excluded), or skipped for one filling session
-- (health_organizer_session_skips) because it ran out or is staying in its bottle this time.
--
-- Skips are their own table, not fill rows with an empty range: a fill row means "these days are in the box", and
-- supply, appointments and the next session's start all read it that way.

ALTER TABLE "health_medications" ADD COLUMN IF NOT EXISTS "organizer_excluded" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "health_organizer_session_skips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "health_organizer_sessions"("id") ON DELETE CASCADE,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "supply_revision" integer,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "undone_at" timestamp with time zone,
  CONSTRAINT "health_organizer_session_skips_reason" CHECK ("reason" IN ('out_of_stock', 'left_out'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "health_organizer_session_skips_active_unique"
  ON "health_organizer_session_skips" ("session_id", "medication_id") WHERE "undone_at" IS NULL;
CREATE INDEX IF NOT EXISTS "health_organizer_session_skips_med_idx"
  ON "health_organizer_session_skips" ("medication_id");

-- No worker_scan policy: nothing outside a household's own context reads this (see 0091).
ALTER TABLE "health_organizer_session_skips" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_session_skips";
CREATE POLICY household_isolation ON "health_organizer_session_skips" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_sessions s JOIN health_organizer_plans p ON p.id = s.plan_id WHERE s.id = health_organizer_session_skips.session_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_sessions s JOIN health_organizer_plans p ON p.id = s.plan_id WHERE s.id = health_organizer_session_skips.session_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM health_medications m WHERE m.id = health_organizer_session_skips.medication_id AND m.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
