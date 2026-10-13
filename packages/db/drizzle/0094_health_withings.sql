-- WHO-452: Withings blood pressure sync. One link per member; the sync outbox lives on the link
-- row (sync_requested_at / next_attempt_at / attempts), like health_myallyfile_links (0083).
-- health_withings_measure_groups is the import's dedupe: (link, grpid) -> the vitals entry it made.
-- event_id is "set null" so deleting an imported entry leaves a tombstone and a backfill can't resurrect it.

DO $$ BEGIN
  CREATE TYPE "withings_link_status" AS ENUM ('active', 'revoked', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "health_withings_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "withings_user_id" text NOT NULL,
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text NOT NULL,
  "token_expires_at" timestamp with time zone NOT NULL,
  "scope" text,
  "status" "withings_link_status" DEFAULT 'active' NOT NULL,
  "linked_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "backfill_from" timestamp with time zone NOT NULL,
  "backfill_done_at" timestamp with time zone,
  "last_update" bigint,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "sync_requested_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "health_withings_links_member_unique"
  ON "health_withings_links" ("member_id");
CREATE INDEX IF NOT EXISTS "health_withings_links_pending_idx"
  ON "health_withings_links" ("sync_requested_at") WHERE "sync_requested_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "health_withings_measure_groups" (
  "link_id" uuid NOT NULL REFERENCES "health_withings_links"("id") ON DELETE cascade,
  "grpid" text NOT NULL,
  "event_id" uuid REFERENCES "health_events"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("link_id", "grpid")
);

CREATE INDEX IF NOT EXISTS "health_withings_measure_groups_event_idx"
  ON "health_withings_measure_groups" ("event_id") WHERE "event_id" IS NOT NULL;

-- RLS. The links table gets a read-only worker_scan policy: the scheduler's tick has to ask which
-- links are due across households, and nothing else. Every write, including the lease and the
-- import itself, runs per household under that household's own context (see WHO-434).
ALTER TABLE "health_withings_links" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_withings_links";
CREATE POLICY household_isolation ON "health_withings_links" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
DROP POLICY IF EXISTS worker_scan ON "health_withings_links";
CREATE POLICY worker_scan ON "health_withings_links" FOR SELECT
  USING (current_setting('app.worker_scan', true) = 'true');

ALTER TABLE "health_withings_measure_groups" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON "health_withings_measure_groups";
CREATE POLICY household_isolation ON "health_withings_measure_groups" FOR ALL
  USING (EXISTS (SELECT 1 FROM health_withings_links p WHERE p.id = health_withings_measure_groups.link_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_withings_links p WHERE p.id = health_withings_measure_groups.link_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
