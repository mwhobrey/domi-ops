-- Medication group membership becomes many-to-many: a medication taken multiple times a day
-- can have different doses belong to different groups (e.g. 8am dose in "Morning meds", 8pm
-- dose in "Evening meds") — a single group_id column on health_medications can't represent
-- that. Preserves any existing group assignments before dropping the old column.

CREATE TABLE IF NOT EXISTS "health_medication_group_members" (
  "group_id" uuid NOT NULL REFERENCES "health_medication_groups"("id") ON DELETE cascade,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  CONSTRAINT "health_medication_group_members_pkey" PRIMARY KEY("group_id","medication_id")
);

-- Preserve existing single-group assignments as the first row of their (now many-to-many)
-- membership before the column goes away.
INSERT INTO "health_medication_group_members" ("group_id", "medication_id")
SELECT "group_id", "id" FROM "health_medications" WHERE "group_id" IS NOT NULL
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS "health_medications_group_id_idx";
ALTER TABLE "health_medications" DROP COLUMN IF EXISTS "group_id";

-- RLS: household_isolation + worker_scan, same EXISTS-join pattern as health_medication_group_shares.
ALTER TABLE "health_medication_group_members" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_group_members";
CREATE POLICY household_isolation ON "health_medication_group_members" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medication_groups p WHERE p.id = health_medication_group_members.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medication_groups p WHERE p.id = health_medication_group_members.group_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_medication_group_members";
CREATE POLICY worker_scan ON "health_medication_group_members" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
