-- WHO-414: pill organizer plans and guided filling sessions.
-- One plan per person: named, ordered compartments (Morning, Lunch, Supper, Night ...), a map from
-- each dose CLOCK TIME to a compartment (medication groups are only a UI shortcut that assigns all
-- of a group's times at once), explicit pill quantities per medication per dose time, a recurring
-- fill appointment, and sessions that record what has physically been placed.
--
-- Placements are never stored per pill-slot. A session records the DATE RANGES each medication has
-- been filled for; coverage is the union of those ranges, and resuming a session never repeats work.
-- Free text a person typed (notes) and the instruction snapshot (medication names, dosage text) are
-- encrypted by the app with the health encryption helpers.

CREATE TABLE IF NOT EXISTS "health_organizer_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "schedule_kind" text NOT NULL,
  "every_n" integer,
  "monthly_day" integer,
  -- The day the schedule counts from (household-local); "every N days" has no meaning without it.
  -- A monthly date beyond a month's length falls on its last day, decided in code, not here.
  "anchor_date" date NOT NULL,
  "fill_length_days" integer DEFAULT 31 NOT NULL,
  -- Household-local time of day for the fill reminder.
  "reminder_time" time DEFAULT '09:00' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  -- Archived, not deleted: sessions and the supply they produced keep their history.
  "archived_at" timestamp with time zone,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Also what limits schedule_kind to the two known values. IS NOT NULL is spelled out: a CHECK
  -- passes when its expression is NULL, and NULL BETWEEN 1 AND 365 is NULL, so without it an
  -- "every N days" plan with no N would be accepted.
  CONSTRAINT "health_organizer_plans_schedule_shape" CHECK (
    ("schedule_kind" = 'every_n_days' AND "every_n" IS NOT NULL AND "every_n" BETWEEN 1 AND 365 AND "monthly_day" IS NULL)
    OR ("schedule_kind" = 'monthly_date' AND "monthly_day" IS NOT NULL AND "monthly_day" BETWEEN 1 AND 31 AND "every_n" IS NULL)
  ),
  CONSTRAINT "health_organizer_plans_fill_length" CHECK ("fill_length_days" BETWEEN 1 AND 93),
  CONSTRAINT "health_organizer_plans_reminder_minute" CHECK (EXTRACT(SECOND FROM "reminder_time") = 0)
);

-- One live plan per person.
CREATE UNIQUE INDEX IF NOT EXISTS "health_organizer_plans_member_active_unique"
  ON "health_organizer_plans" ("member_id") WHERE "archived_at" IS NULL;
CREATE INDEX IF NOT EXISTS "health_organizer_plans_household_idx"
  ON "health_organizer_plans" ("household_id");

-- Who is reminded about this plan's fill appointments (the person configuring it, by default).
CREATE TABLE IF NOT EXISTS "health_organizer_plan_caregivers" (
  "plan_id" uuid NOT NULL REFERENCES "health_organizer_plans"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  PRIMARY KEY ("plan_id", "member_id")
);

CREATE TABLE IF NOT EXISTS "health_organizer_compartments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "health_organizer_plans"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "position" integer NOT NULL,
  CONSTRAINT "health_organizer_compartments_position" CHECK ("position" BETWEEN 0 AND 15),
  CONSTRAINT "health_organizer_compartments_name" CHECK (char_length(btrim("name")) BETWEEN 1 AND 40),
  CONSTRAINT "health_organizer_compartments_order_unique" UNIQUE ("plan_id", "position"),
  -- Target of the composite FK from the time map: a time can only map to a compartment of its own plan.
  CONSTRAINT "health_organizer_compartments_id_plan_unique" UNIQUE ("id", "plan_id")
);

-- Dose clock time -> compartment. Missing times are surfaced as setup problems, never guessed.
CREATE TABLE IF NOT EXISTS "health_organizer_time_map" (
  "plan_id" uuid NOT NULL,
  "dose_time" time NOT NULL,
  "compartment_id" uuid NOT NULL,
  PRIMARY KEY ("plan_id", "dose_time"),
  CONSTRAINT "health_organizer_time_map_minute" CHECK (EXTRACT(SECOND FROM "dose_time") = 0),
  CONSTRAINT "health_organizer_time_map_compartment_fk" FOREIGN KEY ("compartment_id", "plan_id")
    REFERENCES "health_organizer_compartments"("id", "plan_id") ON DELETE cascade
);

-- How many pills go in per scheduled dose time. Stored as integer QUARTERS so fractions sum exactly
-- (0.25 = 1, 0.5 = 2, 1.5 = 6, 2 = 8). Never inferred from the dosage text.
CREATE TABLE IF NOT EXISTS "health_medication_dose_quantities" (
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "dose_time" time NOT NULL,
  "quantity_quarters" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("medication_id", "dose_time"),
  CONSTRAINT "health_medication_dose_quantities_range" CHECK ("quantity_quarters" BETWEEN 1 AND 400),
  CONSTRAINT "health_medication_dose_quantities_minute" CHECK (EXTRACT(SECOND FROM "dose_time") = 0)
);

-- A fill appointment generated from the plan's schedule. Created lazily, one per nominal date.
-- By default it counts as done when a session covering it finishes by the end of its day or the
-- next day; it can be marked skipped, missed or rescheduled before or after the fact.
CREATE TABLE IF NOT EXISTS "health_organizer_occurrences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "health_organizer_plans"("id") ON DELETE cascade,
  "occurrence_date" date NOT NULL,
  "outcome" text DEFAULT 'pending' NOT NULL,
  -- Moves this occurrence only; the plan's schedule is never shifted by completing or moving one.
  "rescheduled_to" date,
  -- Set once the consequences of a skip / miss / reschedule have been looked at.
  "resolved_at" timestamp with time zone,
  "note" text,
  "outcome_changed_at" timestamp with time zone,
  "outcome_changed_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_organizer_occurrences_outcome" CHECK ("outcome" IN ('pending', 'done', 'skipped', 'missed', 'rescheduled')),
  CONSTRAINT "health_organizer_occurrences_rescheduled_pair" CHECK (("outcome" = 'rescheduled') = ("rescheduled_to" IS NOT NULL)),
  CONSTRAINT "health_organizer_occurrences_rescheduled_moves" CHECK ("rescheduled_to" IS NULL OR "rescheduled_to" <> "occurrence_date"),
  CONSTRAINT "health_organizer_occurrences_unique" UNIQUE ("plan_id", "occurrence_date")
);

-- History of outcome changes, kept so a changed mind is visible.
CREATE TABLE IF NOT EXISTS "health_organizer_occurrence_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "occurrence_id" uuid NOT NULL REFERENCES "health_organizer_occurrences"("id") ON DELETE cascade,
  "from_outcome" text NOT NULL,
  "to_outcome" text NOT NULL,
  "note" text,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_organizer_occurrence_events_outcomes" CHECK (
    "from_outcome" IN ('pending', 'done', 'skipped', 'missed', 'rescheduled')
    AND "to_outcome" IN ('pending', 'done', 'skipped', 'missed', 'rescheduled')
  )
);

CREATE INDEX IF NOT EXISTS "health_organizer_occurrence_events_idx"
  ON "health_organizer_occurrence_events" ("occurrence_id", "created_at");

-- A filling session. `snapshot_json` (encrypted) freezes the instructions it was started with, and
-- `snapshot_hash` is a hash of the inputs that produced them: when today's inputs no longer match,
-- further filling needs a review first, and completed fills are never discarded or repeated.
CREATE TABLE IF NOT EXISTS "health_organizer_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "health_organizer_plans"("id") ON DELETE cascade,
  "occurrence_id" uuid REFERENCES "health_organizer_occurrences"("id") ON DELETE set null,
  "coverage_start" date NOT NULL,
  "fill_length_days" integer NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  -- Optimistic concurrency: two caregivers can work one session without overwriting each other.
  "version" integer DEFAULT 1 NOT NULL,
  "snapshot_json" text NOT NULL,
  "snapshot_hash" text NOT NULL,
  "started_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "abandoned_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_organizer_sessions_status" CHECK ("status" IN ('open', 'finished', 'abandoned')),
  CONSTRAINT "health_organizer_sessions_fill_length" CHECK ("fill_length_days" BETWEEN 1 AND 93),
  CONSTRAINT "health_organizer_sessions_finished_pair" CHECK (("status" = 'finished') = ("finished_at" IS NOT NULL)),
  CONSTRAINT "health_organizer_sessions_abandoned_pair" CHECK (("status" = 'abandoned') = ("abandoned_at" IS NOT NULL)),
  CONSTRAINT "health_organizer_sessions_id_plan_unique" UNIQUE ("id", "plan_id")
);

-- One open session per plan, shared by everyone who works on it.
CREATE UNIQUE INDEX IF NOT EXISTS "health_organizer_sessions_open_unique"
  ON "health_organizer_sessions" ("plan_id") WHERE "status" = 'open';
CREATE INDEX IF NOT EXISTS "health_organizer_sessions_plan_idx"
  ON "health_organizer_sessions" ("plan_id", "started_at");

-- One row per medication per save: the date range just filled. Coverage is the union of all the
-- ranges that are not undone, across sessions (an abandoned session's pills are still in the box).
CREATE TABLE IF NOT EXISTS "health_organizer_session_fills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "health_organizer_sessions"("id") ON DELETE cascade,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "covered_from" date NOT NULL,
  "covered_to" date NOT NULL,
  -- A repeated submission carries the same key and gets the first result back, never a second row.
  "idempotency_key" text NOT NULL,
  -- Days of supply the person said they have outside the organizers when they saved this.
  "outside_days" integer,
  -- The supply estimate revision this save produced.
  "supply_revision" integer,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "undone_at" timestamp with time zone,
  CONSTRAINT "health_organizer_session_fills_range" CHECK ("covered_to" >= "covered_from"),
  CONSTRAINT "health_organizer_session_fills_outside_days" CHECK ("outside_days" IS NULL OR "outside_days" >= 0),
  CONSTRAINT "health_organizer_session_fills_idempotency_unique" UNIQUE ("session_id", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "health_organizer_session_fills_session_med_idx"
  ON "health_organizer_session_fills" ("session_id", "medication_id");
-- Coverage for one medication across every session.
CREATE INDEX IF NOT EXISTS "health_organizer_session_fills_med_idx"
  ON "health_organizer_session_fills" ("medication_id") WHERE "undone_at" IS NULL;

-- Now that sessions exist: the supply estimate a fill produced points back at it.
DO $$ BEGIN
  ALTER TABLE "health_medication_supply_revisions"
    ADD CONSTRAINT "health_medication_supply_revisions_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "health_organizer_sessions"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- RLS: household_isolation + worker_scan, same shapes as the other health tables. Plans match their
-- household directly; everything else joins to its plan (or, for quantities, its medication).
ALTER TABLE "health_organizer_plans" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_plans";
CREATE POLICY household_isolation ON "health_organizer_plans" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM household_members m WHERE m.id = health_organizer_plans.member_id AND m.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_organizer_plans";
CREATE POLICY worker_scan ON "health_organizer_plans" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_organizer_plan_caregivers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_plan_caregivers";
CREATE POLICY household_isolation ON "health_organizer_plan_caregivers" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_plan_caregivers.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_plan_caregivers.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM household_members m WHERE m.id = health_organizer_plan_caregivers.member_id AND m.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_organizer_plan_caregivers";
CREATE POLICY worker_scan ON "health_organizer_plan_caregivers" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_organizer_compartments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_compartments";
CREATE POLICY household_isolation ON "health_organizer_compartments" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_compartments.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_compartments.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_organizer_compartments";
CREATE POLICY worker_scan ON "health_organizer_compartments" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_organizer_time_map" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_time_map";
CREATE POLICY household_isolation ON "health_organizer_time_map" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_time_map.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_time_map.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_organizer_time_map";
CREATE POLICY worker_scan ON "health_organizer_time_map" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_medication_dose_quantities" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_dose_quantities";
CREATE POLICY household_isolation ON "health_medication_dose_quantities" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_dose_quantities.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_dose_quantities.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_medication_dose_quantities";
CREATE POLICY worker_scan ON "health_medication_dose_quantities" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_organizer_occurrences" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_occurrences";
CREATE POLICY household_isolation ON "health_organizer_occurrences" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_occurrences.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_occurrences.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_organizer_occurrences";
CREATE POLICY worker_scan ON "health_organizer_occurrences" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_organizer_occurrence_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_occurrence_events";
CREATE POLICY household_isolation ON "health_organizer_occurrence_events" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_occurrences o JOIN health_organizer_plans p ON p.id = o.plan_id WHERE o.id = health_organizer_occurrence_events.occurrence_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_occurrences o JOIN health_organizer_plans p ON p.id = o.plan_id WHERE o.id = health_organizer_occurrence_events.occurrence_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_organizer_occurrence_events";
CREATE POLICY worker_scan ON "health_organizer_occurrence_events" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_organizer_sessions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_sessions";
CREATE POLICY household_isolation ON "health_organizer_sessions" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_sessions.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_organizer_sessions.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
    AND (health_organizer_sessions.occurrence_id IS NULL
      OR EXISTS (SELECT 1 FROM health_organizer_occurrences o WHERE o.id = health_organizer_sessions.occurrence_id AND o.plan_id = health_organizer_sessions.plan_id)));
DROP POLICY IF EXISTS worker_scan ON "health_organizer_sessions";
CREATE POLICY worker_scan ON "health_organizer_sessions" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_organizer_session_fills" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_organizer_session_fills";
CREATE POLICY household_isolation ON "health_organizer_session_fills" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_sessions s JOIN health_organizer_plans p ON p.id = s.plan_id WHERE s.id = health_organizer_session_fills.session_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_sessions s JOIN health_organizer_plans p ON p.id = s.plan_id WHERE s.id = health_organizer_session_fills.session_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM health_medications m WHERE m.id = health_organizer_session_fills.medication_id AND m.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_organizer_session_fills";
CREATE POLICY worker_scan ON "health_organizer_session_fills" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
