CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id" varchar(256) PRIMARY KEY NOT NULL,
  "type" varchar(128) NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
