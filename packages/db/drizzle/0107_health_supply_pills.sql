-- Supply can be entered as a pill count where a medication has a fixed dose. The run-out arithmetic stays in days: the
-- count is converted on the way in and kept here, in quarters of a pill, so a form can show it again and a fill can
-- subtract from it. Null means the estimate was entered in days. Nothing updates it when a dose is logged.

--
-- An interval medication has no dose times to hang a quantity on, so pills per dose for one taken every day or longer
-- sits on the medication itself.

ALTER TABLE "health_medications" ADD COLUMN IF NOT EXISTS "interval_dose_quarters" integer CHECK ("interval_dose_quarters" > 0);
ALTER TABLE "health_medication_supply" ADD COLUMN IF NOT EXISTS "outside_quarters" integer CHECK ("outside_quarters" >= 0);
ALTER TABLE "health_medication_supply_revisions" ADD COLUMN IF NOT EXISTS "outside_quarters" integer CHECK ("outside_quarters" >= 0);
