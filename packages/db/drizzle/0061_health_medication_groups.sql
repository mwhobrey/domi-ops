-- Medication reminder groups: households can bundle several individual medications under one
-- schedule so recipients get one consolidated push instead of N. A grouped medication's own
-- schedule_kind/schedule_json/reminder_offsets_json are left untouched (preserved-but-inert) —
-- the worker scan skips a medication with a non-null group_id and evaluates the group's own
-- schedule instead; ungrouping (or deleting the group, via ON DELETE SET NULL) restores the
-- medication's original standalone schedule with no data loss.

CREATE TABLE IF NOT EXISTS "health_medication_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "schedule_kind" "med_schedule_kind" NOT NULL DEFAULT 'scheduled',
  "schedule_json" text DEFAULT '{}',
  "reminder_offsets_json" text DEFAULT '[0]',
  "start_date" date,
  "end_date" date,
  "enabled" boolean NOT NULL DEFAULT true,
  "visibility" "note_visibility" NOT NULL DEFAULT 'private',
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "health_medication_groups_household_id_idx" ON "health_medication_groups" ("household_id");
CREATE INDEX IF NOT EXISTS "health_medication_groups_member_id_idx" ON "health_medication_groups" ("member_id");

CREATE TABLE IF NOT EXISTS "health_medication_group_shares" (
  "group_id" uuid NOT NULL REFERENCES "health_medication_groups"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  CONSTRAINT "health_medication_group_shares_pkey" PRIMARY KEY("group_id","member_id")
);

ALTER TABLE "health_medications" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "health_medication_groups"("id") ON DELETE set null;
CREATE INDEX IF NOT EXISTS "health_medications_group_id_idx" ON "health_medications" ("group_id");

CREATE TABLE IF NOT EXISTS "health_med_group_reminder_sent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" uuid NOT NULL REFERENCES "health_medication_groups"("id") ON DELETE cascade,
  "scheduled_at" timestamptz NOT NULL,
  "offset_minutes" integer NOT NULL,
  "subscription_id" uuid REFERENCES "push_subscriptions"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "sent_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "health_med_group_reminder_sent_sub_unique"
  ON "health_med_group_reminder_sent" ("group_id", "scheduled_at", "offset_minutes", "subscription_id")
  WHERE "subscription_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "health_med_group_reminder_sent_nosub_unique"
  ON "health_med_group_reminder_sent" ("group_id", "scheduled_at", "offset_minutes", "user_id")
  WHERE "subscription_id" IS NULL;

-- RLS: household_isolation + worker_scan on every new table — same two-policy pattern as
-- health_medications/health_med_reminder_sent (0038 + 0039) and health_vitals_readings (0058).
ALTER TABLE "health_medication_groups" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_groups";
CREATE POLICY household_isolation ON "health_medication_groups" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
DROP POLICY IF EXISTS worker_scan ON "health_medication_groups";
CREATE POLICY worker_scan ON "health_medication_groups" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_medication_group_shares" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_group_shares";
CREATE POLICY household_isolation ON "health_medication_group_shares" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medication_groups p WHERE p.id = health_medication_group_shares.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medication_groups p WHERE p.id = health_medication_group_shares.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_medication_group_shares";
CREATE POLICY worker_scan ON "health_medication_group_shares" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_med_group_reminder_sent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_med_group_reminder_sent";
CREATE POLICY household_isolation ON "health_med_group_reminder_sent" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medication_groups p WHERE p.id = health_med_group_reminder_sent.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medication_groups p WHERE p.id = health_med_group_reminder_sent.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_med_group_reminder_sent";
CREATE POLICY worker_scan ON "health_med_group_reminder_sent" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
