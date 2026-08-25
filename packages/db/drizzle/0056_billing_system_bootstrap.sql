-- The Stripe billing webhook (apps/api/src/routes/billing.ts) provisions households and
-- writes household_subscriptions before any household_id is known to the caller (it looks
-- rows up by stripe_customer_id) — the same "no tenant context yet" trust boundary that
-- households/household_members already got a system_bootstrap policy for in 0039. That
-- migration didn't cover household_subscriptions, so billing writes/reads under the
-- RLS-enforced domi_ops_app role failed until this was caught wiring up the hosted beta.

DROP POLICY IF EXISTS system_bootstrap ON household_subscriptions;
CREATE POLICY system_bootstrap ON household_subscriptions
  FOR ALL
  USING (current_setting('app.system_access', true) = 'true')
  WITH CHECK (current_setting('app.system_access', true) = 'true');
