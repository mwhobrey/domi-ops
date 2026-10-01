-- WHO-356: MyAllyFile medication sync (ADR 006). One link per member, per-med opt-in, and the
-- sync outbox lives on the link row (sync_requested_at / next_attempt_at / attempts).

DO $$ BEGIN
  CREATE TYPE "myallyfile_link_status" AS ENUM ('active', 'entitlement_required', 'revoked', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "health_myallyfile_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "myallyfile_profile_id" text NOT NULL,
  "profile_name" text,
  "instance_label" text,
  "token_encrypted" text NOT NULL,
  "status" "myallyfile_link_status" DEFAULT 'active' NOT NULL,
  "include_prn" boolean DEFAULT false NOT NULL,
  "include_otc" boolean DEFAULT false NOT NULL,
  "include_paused" boolean DEFAULT true NOT NULL,
  "linked_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "last_snapshot_hash" text,
  "sync_requested_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "health_myallyfile_links_member_unique"
  ON "health_myallyfile_links" ("member_id");
CREATE INDEX IF NOT EXISTS "health_myallyfile_links_pending_idx"
  ON "health_myallyfile_links" ("sync_requested_at") WHERE "sync_requested_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "health_medication_myallyfile_sync" (
  "medication_id" uuid PRIMARY KEY NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- RLS: household_isolation + worker_scan, same shape as the other health tables.
ALTER TABLE "health_myallyfile_links" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_myallyfile_links";
CREATE POLICY household_isolation ON "health_myallyfile_links" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
DROP POLICY IF EXISTS worker_scan ON "health_myallyfile_links";
CREATE POLICY worker_scan ON "health_myallyfile_links" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_medication_myallyfile_sync" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_medication_myallyfile_sync";
CREATE POLICY household_isolation ON "health_medication_myallyfile_sync" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_myallyfile_sync.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_myallyfile_sync.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
DROP POLICY IF EXISTS worker_scan ON "health_medication_myallyfile_sync";
CREATE POLICY worker_scan ON "health_medication_myallyfile_sync" FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
