ALTER TABLE "health_med_reminder_sent" ADD COLUMN IF NOT EXISTS "user_id" uuid
  REFERENCES "users"("id") ON DELETE set null;

DROP INDEX IF EXISTS "health_med_reminder_sent_nosub_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "health_med_reminder_sent_nosub_unique"
  ON "health_med_reminder_sent" ("medication_id", "scheduled_at", "offset_minutes", "user_id")
  WHERE "subscription_id" IS NULL;
