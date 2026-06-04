ALTER TABLE "notices" ADD COLUMN IF NOT EXISTS "posted_by_user_id" uuid;
ALTER TABLE "notices" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;
UPDATE "notices" SET "created_at" = "updated_at" WHERE "created_at" IS NULL;
ALTER TABLE "notices" ALTER COLUMN "created_at" SET DEFAULT now();
UPDATE "notices" SET "created_at" = now() WHERE "created_at" IS NULL;

DO $$ BEGIN
  ALTER TABLE "notices" ADD CONSTRAINT "notices_posted_by_user_id_users_id_fk"
    FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "notice_reads" (
  "notice_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notice_reads_notice_id_user_id_pk" PRIMARY KEY("notice_id","user_id")
);

DO $$ BEGIN
  ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_notices_id_fk"
    FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "notice_reads_user_id_idx" ON "notice_reads" ("user_id");
