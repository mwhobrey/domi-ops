DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "household_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "modules_entitled" text NOT NULL,
  "stripe_customer_id" varchar(256),
  "stripe_subscription_id" varchar(256),
  "status" "subscription_status" DEFAULT 'trialing' NOT NULL,
  "trial_ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "household_subscriptions"
    ADD CONSTRAINT "household_subscriptions_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "household_subscriptions_household_id" ON "household_subscriptions" USING btree ("household_id");
