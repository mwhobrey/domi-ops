ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_overlay_school_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_overlay_health_events_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_overlay_health_meds_enabled" boolean DEFAULT true NOT NULL;
