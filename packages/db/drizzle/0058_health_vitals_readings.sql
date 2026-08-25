-- WHO: vitals tracking on the health event log. One row per numeric reading
-- (weight, blood pressure systolic/diastolic, heart rate, etc.) tied to a
-- health_events row of type 'vitals' — see packages/db/src/schema/health.ts.

DO $$ BEGIN
  CREATE TYPE "health_vitals_metric" AS ENUM (
    'weight',
    'height',
    'blood_pressure_systolic',
    'blood_pressure_diastolic',
    'heart_rate',
    'temperature',
    'blood_oxygen',
    'blood_glucose',
    'respiratory_rate',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "health_vitals_readings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "health_events"("id") ON DELETE cascade,
  "metric" "health_vitals_metric" NOT NULL,
  "value" text NOT NULL,
  "unit" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "health_vitals_readings_event_id" ON "health_vitals_readings" ("event_id");

-- Same EXISTS-join pattern as health_medication_logs (0038) — no direct household_id column,
-- reachable only through the parent health_events row.
ALTER TABLE health_vitals_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_vitals_readings;
CREATE POLICY household_isolation ON health_vitals_readings
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM health_events p
    WHERE p.id = health_vitals_readings.event_id
      AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM health_events p
    WHERE p.id = health_vitals_readings.event_id
      AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS worker_scan ON health_vitals_readings;
CREATE POLICY worker_scan ON health_vitals_readings
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
