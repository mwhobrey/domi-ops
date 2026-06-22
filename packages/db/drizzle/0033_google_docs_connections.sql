CREATE TABLE IF NOT EXISTS "google_docs_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "refresh_token_enc" text NOT NULL,
  "access_token_enc" text,
  "token_expiry" timestamp with time zone,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_docs_connections_user_household"
  ON "google_docs_connections" ("user_id", "household_id");
