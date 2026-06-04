DO $$ BEGIN
  CREATE TYPE "temperature_unit" AS ENUM ('fahrenheit', 'celsius');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "temperature_unit" "temperature_unit" NOT NULL DEFAULT 'fahrenheit';
