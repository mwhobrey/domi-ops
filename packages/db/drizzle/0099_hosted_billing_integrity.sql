-- Do not merge tenants or discard existing provider identities to satisfy these constraints.
-- A duplicate aborts this migration and requires an operator's provider reconciliation.
CREATE UNIQUE INDEX "household_subscriptions_customer_unique" ON "household_subscriptions" ("stripe_customer_id");
CREATE UNIQUE INDEX "household_subscriptions_subscription_unique" ON "household_subscriptions" ("stripe_subscription_id");
ALTER TABLE "household_subscriptions" ADD COLUMN "current_period_end" timestamp with time zone;
ALTER TABLE "household_subscriptions" ADD COLUMN "past_due_since" timestamp with time zone;
ALTER TABLE "household_subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;
ALTER TABLE "household_subscriptions" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;
ALTER TABLE "household_subscriptions" ADD COLUMN "source_updated_at" timestamp with time zone;
UPDATE household_subscriptions SET provider = 'revenuecat' WHERE stripe_customer_id LIKE 'rc:%';

-- Upgrade the old complete Starter bundle only. Preserve deliberately partial entitlements.
UPDATE household_subscriptions s
SET modules_entitled = '["core","school","calendar_sync","drive","health","goals"]'
FROM households h
WHERE h.id = s.household_id AND h.tier = 'hosted_starter'
  AND s.modules_entitled::jsonb @> '["core","school","calendar_sync","drive","health"]'::jsonb
  AND NOT s.modules_entitled::jsonb @> '["goals"]'::jsonb;

CREATE TABLE billing_checkout_intents (
  principal_key text PRIMARY KEY NOT NULL,
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plan text NOT NULL CHECK (plan IN ('monthly', 'annual')),
  stripe_customer_id text,
  stripe_session_id text,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE billing_checkout_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_bootstrap ON billing_checkout_intents FOR ALL
  USING (current_setting('app.system_access', true) = 'true')
  WITH CHECK (current_setting('app.system_access', true) = 'true');
