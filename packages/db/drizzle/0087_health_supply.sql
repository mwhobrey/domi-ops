-- WHO-413: medication supply and pharmacies.
-- Supply is a user-confirmed ESTIMATE of the first date a medication runs out, not live inventory:
-- dose logs never change it. A pharmacy directory is shared by the household; which pharmacy a
-- medication uses (optional, one at a time) lives on the medication's supply row, so
-- health_medications itself is untouched.
--
-- Sensitive text (pharmacy name, address, phone, website, notes) is encrypted by the app with the
-- health encryption helpers, like other health text; those columns hold ciphertext.

CREATE TABLE IF NOT EXISTS "health_pharmacies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "address" text,
  "phone" text,
  "website" text,
  "notes" text,
  -- Archived, not deleted: historical refill events keep pointing at it.
  "archived_at" timestamp with time zone,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "health_pharmacies_household_idx"
  ON "health_pharmacies" ("household_id", "archived_at");

-- One row per medication, created the first time anything about its supply is set (a pharmacy, a
-- lead-time override, an estimate). `runs_out_on` is the first date WITHOUT supply: 31 days in
-- organizers plus 10 outside them from day 1 is day 42.
CREATE TABLE IF NOT EXISTS "health_medication_supply" (
  "medication_id" uuid PRIMARY KEY REFERENCES "health_medications"("id") ON DELETE cascade,
  "pharmacy_id" uuid REFERENCES "health_pharmacies"("id") ON DELETE set null,
  -- Per-medication override of health_supply_settings.default_lead_days; null = use the person's.
  "lead_days" integer,
  "runs_out_on" date,
  -- The household-local day the estimate was made; days remaining only ever shrink from here.
  "estimated_on" date,
  "outside_days" integer,
  "organizer_days_counted" integer,
  -- Bumped on every new estimate. Reminder dedupe and "replace pending deadlines" key off it.
  "revision" integer DEFAULT 0 NOT NULL,
  -- Bumped on any change, so concurrent edits are detected instead of silently overwritten.
  "version" integer DEFAULT 1 NOT NULL,
  "requested_at" timestamp with time zone,
  "requested_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "received_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_medication_supply_lead_days_range" CHECK ("lead_days" IS NULL OR "lead_days" BETWEEN 0 AND 90),
  CONSTRAINT "health_medication_supply_days_nonneg" CHECK (
    ("outside_days" IS NULL OR "outside_days" >= 0) AND ("organizer_days_counted" IS NULL OR "organizer_days_counted" >= 0)
  ),
  -- An estimate has both its date and the day it was made, or neither.
  CONSTRAINT "health_medication_supply_estimate_pair" CHECK (("runs_out_on" IS NULL) = ("estimated_on" IS NULL)),
  CONSTRAINT "health_medication_supply_estimate_has_revision" CHECK ("runs_out_on" IS NULL OR "revision" >= 1)
);

CREATE INDEX IF NOT EXISTS "health_medication_supply_pharmacy_idx"
  ON "health_medication_supply" ("pharmacy_id") WHERE "pharmacy_id" IS NOT NULL;
-- What the reminder job sweeps: estimates, soonest run-out first.
CREATE INDEX IF NOT EXISTS "health_medication_supply_runs_out_idx"
  ON "health_medication_supply" ("runs_out_on") WHERE "runs_out_on" IS NOT NULL;

-- Append-only history of every estimate: who, when, and why (an organizer fill, a manual update, a
-- refill receipt, or confirming an estimate after a medication was resumed).
CREATE TABLE IF NOT EXISTS "health_medication_supply_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "revision" integer NOT NULL,
  "source" text NOT NULL,
  "runs_out_on" date NOT NULL,
  "estimated_on" date NOT NULL,
  "outside_days" integer NOT NULL,
  "organizer_days_counted" integer NOT NULL,
  -- The filling session that produced it, when source = 'fill'. Its foreign key is added with the
  -- organizer tables (0088), which are created after this migration.
  "session_id" uuid,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_medication_supply_revisions_source" CHECK ("source" IN ('fill', 'manual', 'receipt', 'confirm')),
  CONSTRAINT "health_medication_supply_revisions_days_nonneg" CHECK ("outside_days" >= 0 AND "organizer_days_counted" >= 0),
  CONSTRAINT "health_medication_supply_revisions_unique" UNIQUE ("medication_id", "revision")
);

-- What was asked of a pharmacy and when: backs "Requested" with its request date and the overdue list.
CREATE TABLE IF NOT EXISTS "health_medication_refill_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "pharmacy_id" uuid REFERENCES "health_pharmacies"("id") ON DELETE set null,
  -- The estimate revision a receipt produced; null for requests.
  "supply_revision" integer,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_medication_refill_events_kind" CHECK ("kind" IN ('requested', 'received', 'request_cleared'))
);

CREATE INDEX IF NOT EXISTS "health_medication_refill_events_med_idx"
  ON "health_medication_refill_events" ("medication_id", "created_at");

-- Person-wide default for how many days before running out to remind. Not on the organizer plan:
-- complex and as-needed medications never enter an organizer but still run out.
CREATE TABLE IF NOT EXISTS "health_supply_settings" (
  "member_id" uuid PRIMARY KEY REFERENCES "household_members"("id") ON DELETE cascade,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "default_lead_days" integer DEFAULT 7 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_supply_settings_lead_days_range" CHECK ("default_lead_days" BETWEEN 0 AND 90)
);

CREATE INDEX IF NOT EXISTS "health_supply_settings_household_idx"
  ON "health_supply_settings" ("household_id");

-- RLS: household_isolation + worker_scan, the same shapes as the medication and check tables.
-- Tables with a household_id match it directly; children join to their parent medication.
ALTER TABLE "health_pharmacies" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_pharmacies";
CREATE POLICY household_isolation ON "health_pharmacies" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
DROP POLICY IF EXISTS worker_scan ON "health_pharmacies";
CREATE POLICY worker_scan ON "health_pharmacies" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_supply_settings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_supply_settings";
CREATE POLICY household_isolation ON "health_supply_settings" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM household_members m WHERE m.id = health_supply_settings.member_id AND m.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_supply_settings";
CREATE POLICY worker_scan ON "health_supply_settings" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_medication_supply" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_supply";
CREATE POLICY household_isolation ON "health_medication_supply" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_supply.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_supply.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
    AND (health_medication_supply.pharmacy_id IS NULL
      OR EXISTS (SELECT 1 FROM health_pharmacies ph WHERE ph.id = health_medication_supply.pharmacy_id AND ph.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)));
DROP POLICY IF EXISTS worker_scan ON "health_medication_supply";
CREATE POLICY worker_scan ON "health_medication_supply" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_medication_supply_revisions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_supply_revisions";
CREATE POLICY household_isolation ON "health_medication_supply_revisions" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_supply_revisions.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_supply_revisions.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_medication_supply_revisions";
CREATE POLICY worker_scan ON "health_medication_supply_revisions" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_medication_refill_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_refill_events";
CREATE POLICY household_isolation ON "health_medication_refill_events" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_refill_events.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_refill_events.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
    AND (health_medication_refill_events.pharmacy_id IS NULL
      OR EXISTS (SELECT 1 FROM health_pharmacies ph WHERE ph.id = health_medication_refill_events.pharmacy_id AND ph.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)));
DROP POLICY IF EXISTS worker_scan ON "health_medication_refill_events";
CREATE POLICY worker_scan ON "health_medication_refill_events" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
