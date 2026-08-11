-- WHO-237: personal budgets, expense attribution, budget shares

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "member_id" uuid
  REFERENCES "household_members"("id") ON DELETE set null;

ALTER TABLE "expense_budgets" ADD COLUMN IF NOT EXISTS "member_id" uuid
  REFERENCES "household_members"("id") ON DELETE cascade;

DROP INDEX IF EXISTS "expense_budgets_household_category";

CREATE UNIQUE INDEX IF NOT EXISTS "expense_budgets_household_category"
  ON "expense_budgets" ("household_id", "category")
  WHERE "member_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "expense_budgets_personal_category"
  ON "expense_budgets" ("household_id", "member_id", "category")
  WHERE "member_id" IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE "expense_budget_share_access" AS ENUM ('read', 'write');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "expense_budget_shares" (
  "budget_id" uuid NOT NULL REFERENCES "expense_budgets"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "access" "expense_budget_share_access" NOT NULL DEFAULT 'read',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "expense_budget_shares_budget_id_member_id_pk" PRIMARY KEY ("budget_id", "member_id")
);

ALTER TABLE "expense_budget_alert_sent" ADD COLUMN IF NOT EXISTS "member_id" uuid
  REFERENCES "household_members"("id") ON DELETE cascade;

DROP INDEX IF EXISTS "expense_budget_alert_sent_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "expense_budget_alert_sent_household_unique"
  ON "expense_budget_alert_sent" ("household_id", "category", "month_key", "alert_kind")
  WHERE "member_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "expense_budget_alert_sent_personal_unique"
  ON "expense_budget_alert_sent" ("household_id", "member_id", "category", "month_key", "alert_kind")
  WHERE "member_id" IS NOT NULL;

ALTER TABLE expense_budget_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON expense_budget_shares;
CREATE POLICY household_isolation ON expense_budget_shares
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM expense_budgets b
    WHERE b.id = expense_budget_shares.budget_id
      AND b.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM expense_budgets b
    WHERE b.id = expense_budget_shares.budget_id
      AND b.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS worker_scan ON expense_budget_shares;
CREATE POLICY worker_scan ON expense_budget_shares
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
