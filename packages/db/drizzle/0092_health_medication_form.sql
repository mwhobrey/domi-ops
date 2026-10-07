-- WHO-445: pills and non-pills. Only pills go in a pill organizer; an IV or injection medication was
-- being flagged for a missing pill quantity. Every existing medication stays a pill until someone says
-- otherwise, so nothing changes for anyone who has not set it.
DO $$ BEGIN
  CREATE TYPE "med_form" AS ENUM ('pill', 'iv', 'injection', 'liquid', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "health_medications" ADD COLUMN IF NOT EXISTS "form" "med_form" NOT NULL DEFAULT 'pill';
