-- WHO-466: Withings sleep (nightly summaries from a ScanWatch or sleep mat). One row per Withings sleep
-- series id, so a re-delivered or edited night updates in place. Durations and the score are encrypted like
-- the rest of the health data; the night's start and end are not, they are what places it on a timeline.
-- sleep_last_update is this feed's own watermark (greatest "modified" seen), apart from the other feeds' clocks.

CREATE TABLE IF NOT EXISTS "health_withings_sleep" (
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "withings_user_id" text NOT NULL,
  "sleep_id" text NOT NULL,
  "date" date NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone NOT NULL,
  "total_sleep_minutes" text,
  "in_bed_minutes" text,
  "light_minutes" text,
  "deep_minutes" text,
  "rem_minutes" text,
  "awake_minutes" text,
  "wake_count" text,
  "sleep_score" text,
  "source_modified" bigint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("member_id", "withings_user_id", "sleep_id")
);

CREATE INDEX IF NOT EXISTS "health_withings_sleep_member_date_idx"
  ON "health_withings_sleep" ("member_id", "date");

ALTER TABLE "health_withings_links" ADD COLUMN IF NOT EXISTS "sleep_last_update" bigint;

ALTER TABLE "health_withings_sleep" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_withings_sleep";
CREATE POLICY household_isolation ON "health_withings_sleep" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
