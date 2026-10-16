-- WHO-465: Withings daily activity (steps, distance, active minutes, calories) from a ScanWatch or phone.
-- One row per (member, Withings user, date, device): a phone and a watch can both report the same day, and an
-- incremental pull returns only the device that changed, so each device keeps its own row and the report picks the
-- best one per date. Values are encrypted like the rest of the health data.
-- activity_last_update is this feed's own watermark (the greatest "modified" seen), kept apart from the
-- measurement and workout ones because Withings does not say they share a clock.

CREATE TABLE IF NOT EXISTS "health_withings_daily_activity" (
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "withings_user_id" text NOT NULL,
  "date" date NOT NULL,
  "device_key" text NOT NULL,
  "is_tracker" boolean DEFAULT false NOT NULL,
  "steps" text,
  "distance_m" text,
  "active_minutes" text,
  "calories_active" text,
  "calories_total" text,
  "source_modified" bigint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("member_id", "withings_user_id", "date", "device_key")
);

CREATE INDEX IF NOT EXISTS "health_withings_daily_activity_member_date_idx"
  ON "health_withings_daily_activity" ("member_id", "date");

ALTER TABLE "health_withings_links" ADD COLUMN IF NOT EXISTS "activity_last_update" bigint;

ALTER TABLE "health_withings_daily_activity" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_withings_daily_activity";
CREATE POLICY household_isolation ON "health_withings_daily_activity" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
