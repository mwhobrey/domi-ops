ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "telemetry_opt_in" boolean NOT NULL DEFAULT false;
