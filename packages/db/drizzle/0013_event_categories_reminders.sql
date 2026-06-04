CREATE TABLE IF NOT EXISTS "event_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "key" varchar(64) NOT NULL,
  "label" varchar(128) NOT NULL,
  "color" varchar(16),
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_categories_household_key" ON "event_categories" ("household_id", "key");

CREATE TABLE IF NOT EXISTS "calendar_event_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "calendar_events"("id") ON DELETE cascade,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "offset_minutes" integer NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "calendar_event_reminders_event_idx" ON "calendar_event_reminders" ("event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_event_reminders_event_offset" ON "calendar_event_reminders" ("event_id", "offset_minutes");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_calendar_reminders_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "recurring_rules" ADD COLUMN IF NOT EXISTS "start_time" time;
ALTER TABLE "recurring_rules" ADD COLUMN IF NOT EXISTS "end_time" time;
ALTER TABLE "recurring_rules" ADD COLUMN IF NOT EXISTS "all_day" boolean DEFAULT false NOT NULL;
