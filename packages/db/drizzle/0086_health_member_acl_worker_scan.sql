-- WHO-403: let the reminder worker read health_member_acl.
--
-- Every other health table has a worker_scan policy next to household_isolation. This one had only
-- household_isolation, so inside withWorkerScanContext (cross-tenant, no household set) the table
-- looked empty under the RLS role. The reminder scans find a person's caregivers by reading it
-- (grantees with doses: write for medications, events: write for health checks), so on hosted only
-- the person themselves was ever reminded and the caregivers silently were not. Superuser
-- connections (single-tenant self-host) bypass RLS and were unaffected.
--
-- SELECT only: the scans read the ACL, they never write it, and the worker context should not be
-- able to change who can see someone's health data. (The other tables use FOR ALL, which is wider
-- than they need.)

DROP POLICY IF EXISTS worker_scan ON "health_member_acl";
CREATE POLICY worker_scan ON "health_member_acl" FOR SELECT
  USING (current_setting('app.worker_scan', true) = 'true');
