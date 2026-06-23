DO $$ BEGIN
  CREATE TYPE "health_event_duration_kind" AS ENUM('single_day', 'ongoing');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "health_events"
  ADD COLUMN IF NOT EXISTS "duration_kind" "health_event_duration_kind" NOT NULL DEFAULT 'single_day';
