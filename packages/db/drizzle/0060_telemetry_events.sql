-- Opt-in, anonymized metrics. No household_id/userId anywhere in this file — see
-- packages/db/src/schema/telemetry.ts for the anonymization guarantee this encodes.
-- Not RLS-protected, same reasoning as stripe_events (0054): nothing to scope by.

DO $$ BEGIN
  CREATE TYPE "telemetry_event_kind" AS ENUM ('web_vital', 'error', 'usage');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "telemetry_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "anon_id" uuid NOT NULL,
  "kind" "telemetry_event_kind" NOT NULL,
  "name" varchar(256) NOT NULL,
  "value" integer,
  "path" varchar(256),
  "deployment_mode" varchar(16),
  "app_version" varchar(32),
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "telemetry_events_kind_name_idx" ON "telemetry_events" ("kind", "name");
CREATE INDEX IF NOT EXISTS "telemetry_events_created_at_idx" ON "telemetry_events" ("created_at");

CREATE TABLE IF NOT EXISTS "telemetry_bug_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "anon_id" uuid NOT NULL,
  "message" text NOT NULL,
  "email" varchar(320),
  "deployment_mode" varchar(16),
  "app_version" varchar(32),
  "path" varchar(256),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
