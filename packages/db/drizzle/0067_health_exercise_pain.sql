-- WHO-297: exercise and pain tracking on the health event log, following the same
-- event + typed detail rows pattern as vitals (0058) — see packages/db/src/schema/health.ts.

ALTER TYPE "health_event_type" ADD VALUE IF NOT EXISTS 'exercise';
ALTER TYPE "health_event_type" ADD VALUE IF NOT EXISTS 'pain';

DO $$ BEGIN
  CREATE TYPE "health_pain_body_region" AS ENUM (
    'front_head',
    'face',
    'neck_front',
    'chest',
    'abdomen',
    'groin',
    'left_shoulder',
    'right_shoulder',
    'left_upper_arm',
    'right_upper_arm',
    'left_forearm',
    'right_forearm',
    'left_hand',
    'right_hand',
    'left_thigh',
    'right_thigh',
    'left_shin',
    'right_shin',
    'left_foot',
    'right_foot',
    'back_head',
    'neck_back',
    'upper_back',
    'lower_back',
    'buttocks',
    'left_shoulder_blade',
    'right_shoulder_blade',
    'left_hamstring',
    'right_hamstring',
    'left_calf',
    'right_calf'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "health_exercise_details" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "health_events"("id") ON DELETE cascade,
  "activity" text NOT NULL,
  "duration_minutes" text,
  "intensity" text,
  "distance" text,
  "distance_unit" text,
  "sets" text,
  "reps" text,
  "calories_estimated" text,
  "external_source" text NOT NULL DEFAULT 'manual',
  "external_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "health_exercise_details_event_id" ON "health_exercise_details" ("event_id");

CREATE TABLE IF NOT EXISTS "health_pain_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "health_events"("id") ON DELETE cascade,
  "body_region" "health_pain_body_region" NOT NULL,
  "severity" text NOT NULL,
  "quality_tags" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "health_pain_logs_event_id" ON "health_pain_logs" ("event_id");

-- Same EXISTS-join pattern as health_vitals_readings (0058) / health_medication_logs (0038) —
-- no direct household_id column, reachable only through the parent health_events row.
ALTER TABLE health_exercise_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_exercise_details;
CREATE POLICY household_isolation ON health_exercise_details
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM health_events p
    WHERE p.id = health_exercise_details.event_id
      AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM health_events p
    WHERE p.id = health_exercise_details.event_id
      AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS worker_scan ON health_exercise_details;
CREATE POLICY worker_scan ON health_exercise_details
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE health_pain_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_pain_logs;
CREATE POLICY household_isolation ON health_pain_logs
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM health_events p
    WHERE p.id = health_pain_logs.event_id
      AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM health_events p
    WHERE p.id = health_pain_logs.event_id
      AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS worker_scan ON health_pain_logs;
CREATE POLICY worker_scan ON health_pain_logs
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
