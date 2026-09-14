-- Native store push (WHO-289 / ADR 005): APNs/FCM device tokens beside Web Push (VAPID).
ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "platform" varchar(16) NOT NULL DEFAULT 'web';
--> statement-breakpoint
ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "device_token" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_device_token_idx"
  ON "push_subscriptions" ("device_token")
  WHERE "device_token" IS NOT NULL;
