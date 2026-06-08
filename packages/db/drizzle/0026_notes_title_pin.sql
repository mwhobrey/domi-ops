ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "title" varchar(256);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "notes"
SET "title" = COALESCE(
  NULLIF(
    LEFT(
      TRIM(split_part(REPLACE(REPLACE(REPLACE("content", E'\r\n', E'\n'), E'\r', E'\n'), E'\n', E'\n'), E'\n', 1)),
      256
    ),
    ''
  ),
  NULLIF(LEFT(TRIM("content"), 256), ''),
  'Untitled'
)
WHERE "title" IS NULL OR TRIM("title") = '';
--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "title" SET NOT NULL;
