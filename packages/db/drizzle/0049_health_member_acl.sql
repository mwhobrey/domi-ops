-- WHO-229: per-grantee health segment ACL (events / medications / doses / reports)
DO $$ BEGIN
  CREATE TYPE "health_acl_level" AS ENUM('none', 'read', 'write');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "health_member_acl" (
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "subject_member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "grantee_member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "events_access" "health_acl_level" DEFAULT 'none' NOT NULL,
  "medications_access" "health_acl_level" DEFAULT 'none' NOT NULL,
  "doses_access" "health_acl_level" DEFAULT 'none' NOT NULL,
  "reports_access" "health_acl_level" DEFAULT 'none' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_member_acl_pkey" PRIMARY KEY("subject_member_id","grantee_member_id"),
  CONSTRAINT "health_member_acl_no_self" CHECK ("subject_member_id" <> "grantee_member_id")
);

CREATE INDEX IF NOT EXISTS "health_member_acl_grantee_idx"
  ON "health_member_acl" ("household_id", "grantee_member_id");

ALTER TABLE health_member_acl ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_member_acl;
CREATE POLICY household_isolation ON health_member_acl
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
