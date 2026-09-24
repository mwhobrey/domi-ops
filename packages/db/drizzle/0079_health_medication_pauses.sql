-- WHO-338: medication soft delete + pause history.
-- Deleting a medication used to hard-delete it, cascading away its whole dose history.
-- Now it sets deleted_at; the row stays so health_medication_logs keep their parent.

ALTER TABLE "health_medications" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

-- Pause periods (enabled → false, then back), so adherence can skip doses that were never due.
CREATE TABLE IF NOT EXISTS "health_medication_pauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "paused_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resumed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "health_medication_pauses_medication_id_idx"
  ON "health_medication_pauses" ("medication_id");

-- Meds already disabled have no record of when; updated_at is the closest guess.
INSERT INTO "health_medication_pauses" ("medication_id", "paused_at")
SELECT "id", "updated_at" FROM "health_medications" m
WHERE m."enabled" = false
  AND NOT EXISTS (SELECT 1 FROM "health_medication_pauses" p WHERE p."medication_id" = m."id");

-- RLS: household_isolation + worker_scan, same EXISTS-join pattern as health_medication_logs.
ALTER TABLE "health_medication_pauses" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_pauses";
CREATE POLICY household_isolation ON "health_medication_pauses" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_pauses.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_pauses.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_medication_pauses";
CREATE POLICY worker_scan ON "health_medication_pauses" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
