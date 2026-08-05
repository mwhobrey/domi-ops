ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "timezone" varchar(64);

ALTER TABLE "health_med_reminder_sent" ADD COLUMN IF NOT EXISTS "subscription_id" uuid
  REFERENCES "push_subscriptions"("id") ON DELETE cascade;

DROP INDEX IF EXISTS "health_med_reminder_sent_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "health_med_reminder_sent_sub_unique"
  ON "health_med_reminder_sent" ("medication_id", "scheduled_at", "offset_minutes", "subscription_id")
  WHERE "subscription_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "health_med_reminder_sent_nosub_unique"
  ON "health_med_reminder_sent" ("medication_id", "scheduled_at", "offset_minutes")
  WHERE "subscription_id" IS NULL;
