CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "title" varchar(256) NOT NULL,
  "body" text NOT NULL,
  "url" varchar(512) DEFAULT '/dashboard' NOT NULL,
  "tag" varchar(128),
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "user_notifications_user_created_idx"
  ON "user_notifications" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "user_notifications_user_unread_idx"
  ON "user_notifications" ("user_id") WHERE "read_at" IS NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "chore_digest_sent_on" varchar(10);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_shopping_reminders_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "drive_quota_warn_sent_at" timestamp with time zone;
