-- WHO-364: MyAllyFile sync now covers all of a member's medications, so the per-medication opt-in
-- table from 0083 is gone, and as-needed / OTC meds are included unless switched off.
DROP TABLE IF EXISTS "health_medication_myallyfile_sync";

ALTER TABLE "health_myallyfile_links" ALTER COLUMN "include_prn" SET DEFAULT true;
ALTER TABLE "health_myallyfile_links" ALTER COLUMN "include_otc" SET DEFAULT true;

-- Links created under 0083 got the old false defaults without anyone choosing them.
UPDATE "health_myallyfile_links" SET "include_prn" = true, "include_otc" = true;
