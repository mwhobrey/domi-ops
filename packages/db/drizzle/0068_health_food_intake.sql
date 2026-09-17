-- WHO-304: food/nutrition tracking on the health event log, following the same event + typed
-- detail rows pattern as vitals (0058) / exercise (0067) — see packages/db/src/schema/health.ts.

ALTER TYPE "health_event_type" ADD VALUE IF NOT EXISTS 'food_intake';

CREATE TABLE IF NOT EXISTS "health_food_log_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "health_events"("id") ON DELETE cascade,
  "food_name" text NOT NULL,
  "quantity" text NOT NULL,
  "unit" text NOT NULL,
  "calories" text,
  "protein_g" text,
  "carbs_g" text,
  "fat_g" text,
  "source" text NOT NULL DEFAULT 'manual',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "health_food_log_entries_event_id" ON "health_food_log_entries" ("event_id");

-- Same EXISTS-join pattern as health_vitals_readings (0058) / health_exercise_details (0067) —
-- no direct household_id column, reachable only through the parent health_events row.
ALTER TABLE health_food_log_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_food_log_entries;
CREATE POLICY household_isolation ON health_food_log_entries
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM health_events p
    WHERE p.id = health_food_log_entries.event_id
      AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM health_events p
    WHERE p.id = health_food_log_entries.event_id
      AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS worker_scan ON health_food_log_entries;
CREATE POLICY worker_scan ON health_food_log_entries
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
