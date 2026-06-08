CREATE TABLE IF NOT EXISTS "expense_budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "category" varchar(64) NOT NULL,
  "monthly_target" real NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "expense_budgets" ADD CONSTRAINT "expense_budgets_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "expense_budgets_household_category" ON "expense_budgets" ("household_id", "category");

CREATE TABLE IF NOT EXISTS "expense_budget_alert_sent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "category" varchar(64) NOT NULL,
  "month_key" varchar(7) NOT NULL,
  "alert_kind" varchar(16) NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "expense_budget_alert_sent" ADD CONSTRAINT "expense_budget_alert_sent_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "expense_budget_alert_sent_unique"
  ON "expense_budget_alert_sent" ("household_id", "category", "month_key", "alert_kind");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_expense_budget_alerts_enabled" boolean NOT NULL DEFAULT true;
