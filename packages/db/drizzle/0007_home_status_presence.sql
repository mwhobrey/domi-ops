ALTER TABLE "home_status" ADD COLUMN IF NOT EXISTS "presence" varchar(8);
ALTER TABLE "home_status" ADD COLUMN IF NOT EXISTS "status_message" varchar(64);

UPDATE "home_status"
SET
  "presence" = CASE WHEN "status" IN ('Home', 'Away') THEN "status" ELSE 'Away' END,
  "status_message" = CASE WHEN "status" IN ('Home', 'Away') THEN NULL ELSE "status" END
WHERE "presence" IS NULL;

UPDATE "home_status" SET "presence" = 'Away' WHERE "presence" IS NULL;

ALTER TABLE "home_status" ALTER COLUMN "presence" SET DEFAULT 'Away';
ALTER TABLE "home_status" ALTER COLUMN "presence" SET NOT NULL;

ALTER TABLE "home_status" DROP COLUMN "status";
