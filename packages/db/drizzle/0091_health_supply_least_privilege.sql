-- WHO-434: the supply, pharmacy and organizer tables give the worker no cross-tenant read it does not use.
--
-- Migrations 0087, 0088 and 0090 gave every new table a `worker_scan` policy out of habit. The only cross-tenant
-- reads the supply reminders make are the scheduler's tick, which asks which households have an organizer plan or a
-- supply estimate (`health_organizer_plans`, `health_medication_supply`, and `health_medications` which already has
-- one). The reminder job itself runs per household under that household's own context (WHO-403, WHO-404), and so does
-- everything the API does, so the policy on every other table only widened what a worker-scan transaction could see
-- (medication-adjacent health data across all households) for no reason. Same call as `health_member_acl` (WHO-403).
--
-- The household_isolation policies are untouched. Dropping a policy that is not there is harmless, so this is safe to rerun.

DROP POLICY IF EXISTS worker_scan ON "health_pharmacies";
DROP POLICY IF EXISTS worker_scan ON "health_medication_supply_revisions";
DROP POLICY IF EXISTS worker_scan ON "health_medication_refill_events";
DROP POLICY IF EXISTS worker_scan ON "health_supply_settings";
DROP POLICY IF EXISTS worker_scan ON "health_medication_dose_quantities";
DROP POLICY IF EXISTS worker_scan ON "health_organizer_compartments";
DROP POLICY IF EXISTS worker_scan ON "health_organizer_time_map";
DROP POLICY IF EXISTS worker_scan ON "health_organizer_plan_caregivers";
DROP POLICY IF EXISTS worker_scan ON "health_organizer_occurrences";
DROP POLICY IF EXISTS worker_scan ON "health_organizer_occurrence_events";
DROP POLICY IF EXISTS worker_scan ON "health_organizer_sessions";
DROP POLICY IF EXISTS worker_scan ON "health_organizer_session_fills";
DROP POLICY IF EXISTS worker_scan ON "health_supply_fill_reminder_sent";
DROP POLICY IF EXISTS worker_scan ON "health_supply_refill_reminder_sent";
