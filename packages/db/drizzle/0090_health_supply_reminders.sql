-- WHO-432 / WHO-433: reminders for pill organizer fills and medication refills.
--
-- Each reminder is recorded when it is claimed, and the unique indexes are what make "once" true: a retried job, a
-- scan that overlaps another, or a second worker cannot send the same reminder to the same person twice.
--
--   * a fill reminder is one per appointment (plan + the day the schedule put it on) and person
--   * a refill reminder is one per supply estimate (medication + revision), kind and person, so a new estimate
--     (a new revision) is free to remind again for its own, moved deadline

CREATE TABLE IF NOT EXISTS "health_supply_fill_reminder_sent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "health_organizer_plans"("id") ON DELETE CASCADE,
  "occurrence_date" date NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "health_supply_fill_reminder_sent_unique"
  ON "health_supply_fill_reminder_sent" ("plan_id", "occurrence_date", "user_id");

CREATE TABLE IF NOT EXISTS "health_supply_refill_reminder_sent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  -- 'refill': the deadline came. 'waiting': a requested refill, two days before the supply runs out.
  "kind" text NOT NULL CHECK ("kind" IN ('refill', 'waiting')),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "health_supply_refill_reminder_sent_unique"
  ON "health_supply_refill_reminder_sent" ("medication_id", "revision", "kind", "user_id");

ALTER TABLE "health_supply_fill_reminder_sent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_supply_fill_reminder_sent";
CREATE POLICY household_isolation ON "health_supply_fill_reminder_sent" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_supply_fill_reminder_sent.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_organizer_plans p WHERE p.id = health_supply_fill_reminder_sent.plan_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_supply_fill_reminder_sent";
CREATE POLICY worker_scan ON "health_supply_fill_reminder_sent" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_supply_refill_reminder_sent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_supply_refill_reminder_sent";
CREATE POLICY household_isolation ON "health_supply_refill_reminder_sent" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications m WHERE m.id = health_supply_refill_reminder_sent.medication_id AND m.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications m WHERE m.id = health_supply_refill_reminder_sent.medication_id AND m.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_supply_refill_reminder_sent";
CREATE POLICY worker_scan ON "health_supply_refill_reminder_sent" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
