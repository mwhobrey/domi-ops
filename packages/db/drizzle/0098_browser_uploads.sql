CREATE TABLE "browser_uploads" (
  "id" uuid PRIMARY KEY NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid REFERENCES "household_members"("id") ON DELETE set null,
  "purpose" text NOT NULL CHECK (purpose IN ('drive', 'school', 'receipt', 'school_snapshot')),
  "s3_key" text NOT NULL,
  "content_type" text NOT NULL,
  "max_bytes" bigint NOT NULL CHECK (max_bytes >= 0),
  "byte_size" bigint CHECK (byte_size >= 0 AND byte_size <= max_bytes),
  "state" text DEFAULT 'issued' NOT NULL CHECK (state IN ('issued', 'uploaded', 'consumed')),
  "claimed_by" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "browser_uploads_s3_key" ON "browser_uploads" ("s3_key");
ALTER TABLE "browser_uploads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON "browser_uploads" FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
