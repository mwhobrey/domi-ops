-- WHO-379 / WHO-380: scheduled health checks ("log vitals / pain / food / exercise at these times").
-- Sibling to medications: same schedule kinds, groups, shares, pauses, reminder dedupe. A check is
-- completed by a health_events row of its event_type; health_check_logs.health_event_id is the
-- link (health_events itself is untouched, and one event may satisfy more than one check).

DO $$ BEGIN
  CREATE TYPE "health_check_log_status" AS ENUM ('done', 'skipped', 'missed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "health_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "event_type" "health_event_type" NOT NULL,
  "template_json" text DEFAULT '{}',
  "schedule_kind" "med_schedule_kind" DEFAULT 'scheduled' NOT NULL,
  "schedule_json" text DEFAULT '{}',
  "reminder_offsets_json" text DEFAULT '[0]',
  "start_date" date,
  "end_date" date,
  "enabled" boolean DEFAULT true NOT NULL,
  "visibility" "note_visibility" DEFAULT 'private' NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  -- A medication dose is logged through health_medication_logs, not a check.
  CONSTRAINT "health_checks_event_type_not_medication" CHECK ("event_type"::text <> 'medication'),
  -- prn / otc have no due time to remind about.
  CONSTRAINT "health_checks_schedule_kind_timed" CHECK ("schedule_kind"::text IN ('scheduled', 'interval'))
);

CREATE INDEX IF NOT EXISTS "health_checks_household_member_idx"
  ON "health_checks" ("household_id", "member_id");

CREATE TABLE IF NOT EXISTS "health_check_shares" (
  "check_id" uuid NOT NULL REFERENCES "health_checks"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  PRIMARY KEY ("check_id", "member_id")
);

CREATE TABLE IF NOT EXISTS "health_check_pauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "check_id" uuid NOT NULL REFERENCES "health_checks"("id") ON DELETE cascade,
  "paused_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resumed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "health_check_pauses_check_id_idx"
  ON "health_check_pauses" ("check_id");

CREATE TABLE IF NOT EXISTS "health_check_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "schedule_kind" "med_schedule_kind" DEFAULT 'scheduled' NOT NULL,
  "schedule_json" text DEFAULT '{}',
  "reminder_offsets_json" text DEFAULT '[0]',
  "start_date" date,
  "end_date" date,
  "enabled" boolean DEFAULT true NOT NULL,
  "visibility" "note_visibility" DEFAULT 'private' NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_check_groups_schedule_kind_timed" CHECK ("schedule_kind"::text IN ('scheduled', 'interval'))
);

CREATE INDEX IF NOT EXISTS "health_check_groups_household_member_idx"
  ON "health_check_groups" ("household_id", "member_id");

CREATE TABLE IF NOT EXISTS "health_check_group_shares" (
  "group_id" uuid NOT NULL REFERENCES "health_check_groups"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  PRIMARY KEY ("group_id", "member_id")
);

CREATE TABLE IF NOT EXISTS "health_check_group_members" (
  "group_id" uuid NOT NULL REFERENCES "health_check_groups"("id") ON DELETE cascade,
  "check_id" uuid NOT NULL REFERENCES "health_checks"("id") ON DELETE cascade,
  PRIMARY KEY ("group_id", "check_id")
);

-- One row per completed / skipped / missed slot. scheduled_at is always set (every log is for a
-- slot; an ad-hoc reading is just a health_events row that may auto-match a slot).
CREATE TABLE IF NOT EXISTS "health_check_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "check_id" uuid NOT NULL REFERENCES "health_checks"("id") ON DELETE cascade,
  "scheduled_at" timestamp with time zone NOT NULL,
  "status" "health_check_log_status" NOT NULL,
  "logged_at" timestamp with time zone DEFAULT now() NOT NULL,
  "logged_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "notes" text,
  "health_event_id" uuid REFERENCES "health_events"("id") ON DELETE set null
);

-- DB backstop behind the single writer (recordCheck): one log per check per scheduled instant.
CREATE UNIQUE INDEX IF NOT EXISTS "health_check_logs_instant_unique"
  ON "health_check_logs" ("check_id", "scheduled_at");
CREATE INDEX IF NOT EXISTS "health_check_logs_event_idx"
  ON "health_check_logs" ("health_event_id") WHERE "health_event_id" IS NOT NULL;

-- Reminder dedupe, same shapes as health_med_reminder_sent / health_med_group_reminder_sent.
CREATE TABLE IF NOT EXISTS "health_check_reminder_sent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "check_id" uuid NOT NULL REFERENCES "health_checks"("id") ON DELETE cascade,
  "scheduled_at" timestamp with time zone NOT NULL,
  "offset_minutes" integer NOT NULL,
  "subscription_id" uuid REFERENCES "push_subscriptions"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "health_check_reminder_sent_sub_unique"
  ON "health_check_reminder_sent" ("check_id", "scheduled_at", "offset_minutes", "subscription_id")
  WHERE "subscription_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "health_check_reminder_sent_nosub_unique"
  ON "health_check_reminder_sent" ("check_id", "scheduled_at", "offset_minutes", "user_id")
  WHERE "subscription_id" IS NULL;

CREATE TABLE IF NOT EXISTS "health_check_group_reminder_sent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "health_check_groups"("id") ON DELETE cascade,
  "scheduled_at" timestamp with time zone NOT NULL,
  "offset_minutes" integer NOT NULL,
  "subscription_id" uuid REFERENCES "push_subscriptions"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "health_check_group_reminder_sent_sub_unique"
  ON "health_check_group_reminder_sent" ("group_id", "scheduled_at", "offset_minutes", "subscription_id")
  WHERE "subscription_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "health_check_group_reminder_sent_nosub_unique"
  ON "health_check_group_reminder_sent" ("group_id", "scheduled_at", "offset_minutes", "user_id")
  WHERE "subscription_id" IS NULL;

-- RLS: household_isolation + worker_scan, same shapes as the medication tables. Tables with a
-- household_id match it directly; children EXISTS-join to their parent check / group.
ALTER TABLE "health_checks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_checks";
CREATE POLICY household_isolation ON "health_checks" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
DROP POLICY IF EXISTS worker_scan ON "health_checks";
CREATE POLICY worker_scan ON "health_checks" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_check_groups" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_check_groups";
CREATE POLICY household_isolation ON "health_check_groups" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
DROP POLICY IF EXISTS worker_scan ON "health_check_groups";
CREATE POLICY worker_scan ON "health_check_groups" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_check_shares" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_check_shares";
CREATE POLICY household_isolation ON "health_check_shares" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_checks p WHERE p.id = health_check_shares.check_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_checks p WHERE p.id = health_check_shares.check_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_check_shares";
CREATE POLICY worker_scan ON "health_check_shares" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_check_pauses" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_check_pauses";
CREATE POLICY household_isolation ON "health_check_pauses" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_checks p WHERE p.id = health_check_pauses.check_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_checks p WHERE p.id = health_check_pauses.check_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_check_pauses";
CREATE POLICY worker_scan ON "health_check_pauses" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_check_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_check_logs";
CREATE POLICY household_isolation ON "health_check_logs" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_checks p WHERE p.id = health_check_logs.check_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_checks p WHERE p.id = health_check_logs.check_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_check_logs";
CREATE POLICY worker_scan ON "health_check_logs" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_check_reminder_sent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_check_reminder_sent";
CREATE POLICY household_isolation ON "health_check_reminder_sent" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_checks p WHERE p.id = health_check_reminder_sent.check_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_checks p WHERE p.id = health_check_reminder_sent.check_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_check_reminder_sent";
CREATE POLICY worker_scan ON "health_check_reminder_sent" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_check_group_shares" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_check_group_shares";
CREATE POLICY household_isolation ON "health_check_group_shares" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_check_groups p WHERE p.id = health_check_group_shares.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_check_groups p WHERE p.id = health_check_group_shares.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_check_group_shares";
CREATE POLICY worker_scan ON "health_check_group_shares" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_check_group_members" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_check_group_members";
CREATE POLICY household_isolation ON "health_check_group_members" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_check_groups p WHERE p.id = health_check_group_members.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_check_groups p WHERE p.id = health_check_group_members.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_check_group_members";
CREATE POLICY worker_scan ON "health_check_group_members" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_check_group_reminder_sent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_check_group_reminder_sent";
CREATE POLICY household_isolation ON "health_check_group_reminder_sent" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_check_groups p WHERE p.id = health_check_group_reminder_sent.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_check_groups p WHERE p.id = health_check_group_reminder_sent.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_check_group_reminder_sent";
CREATE POLICY worker_scan ON "health_check_group_reminder_sent" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
