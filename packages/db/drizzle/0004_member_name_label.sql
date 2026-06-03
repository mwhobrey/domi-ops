DO $$ BEGIN
  CREATE TYPE "member_public_label" AS ENUM ('name', 'nickname');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "name" varchar(128);

ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "public_label" "member_public_label" NOT NULL DEFAULT 'name';

UPDATE "household_members" hm
SET "name" = u."display_name"
FROM "users" u
WHERE hm."user_id" = u."id" AND hm."name" IS NULL AND u."display_name" IS NOT NULL;
