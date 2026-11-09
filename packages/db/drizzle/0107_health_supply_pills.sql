-- Supply can be entered as a pill count where a medication has a fixed dose. The run-out arithmetic stays in days: the
-- count is converted on the way in and kept here, in quarters of a pill, so a form can show it again and a fill can
-- subtract from it. Null means the estimate was entered in days. Nothing updates it when a dose is logged.

ALTER TABLE "health_medication_supply" ADD COLUMN IF NOT EXISTS "outside_quarters" integer CHECK ("outside_quarters" >= 0);
ALTER TABLE "health_medication_supply_revisions" ADD COLUMN IF NOT EXISTS "outside_quarters" integer CHECK ("outside_quarters" >= 0);
