-- WHO-462: workouts get their own incremental watermark. Until now a workout pull reused
-- last_update (the getmeas updatetime) minus a day, which assumes the two Withings clocks agree to within a day.
-- This holds the greatest workout "modified" seen. Null = none yet, and the pull keeps using the old fallback.
ALTER TABLE "health_withings_links" ADD COLUMN IF NOT EXISTS "workouts_last_update" bigint;
