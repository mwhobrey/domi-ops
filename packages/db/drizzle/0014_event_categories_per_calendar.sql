ALTER TABLE "event_categories" ADD COLUMN IF NOT EXISTS "calendar_id" uuid;
ALTER TABLE "event_categories" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;

UPDATE "event_categories" ec
SET "calendar_id" = sub.calendar_id
FROM (
  SELECT DISTINCT ON (ec2.id)
    ec2.id AS category_id,
    COALESCE(
      (
        SELECT ce.calendar_id
        FROM "calendar_events" ce
        WHERE ce.household_id = ec2.household_id
          AND ce.category_key = ec2.key
        GROUP BY ce.calendar_id
        ORDER BY count(*) DESC
        LIMIT 1
      ),
      (
        SELECT c.id
        FROM "calendars" c
        WHERE c.household_id = ec2.household_id
          AND c.archived = false
        ORDER BY c.created_at
        LIMIT 1
      )
    ) AS calendar_id
  FROM "event_categories" ec2
) sub
WHERE ec.id = sub.category_id
  AND ec.calendar_id IS NULL;

DELETE FROM "event_categories" WHERE "calendar_id" IS NULL;

ALTER TABLE "event_categories"
  ALTER COLUMN "calendar_id" SET NOT NULL;

ALTER TABLE "event_categories"
  ADD CONSTRAINT "event_categories_calendar_id_calendars_id_fk"
  FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;

DROP INDEX IF EXISTS "event_categories_household_key";

CREATE UNIQUE INDEX IF NOT EXISTS "event_categories_calendar_key"
  ON "event_categories" ("calendar_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "event_categories_one_default"
  ON "event_categories" ("calendar_id")
  WHERE "is_default" = true;

CREATE INDEX IF NOT EXISTS "event_categories_calendar_idx"
  ON "event_categories" ("calendar_id");

UPDATE "event_categories"
SET "is_default" = true
WHERE "key" = 'general';

UPDATE "event_categories" ec
SET "is_default" = true
WHERE NOT EXISTS (
  SELECT 1 FROM "event_categories" d
  WHERE d.calendar_id = ec.calendar_id AND d.is_default = true
)
AND ec.id = (
  SELECT ec2.id FROM "event_categories" ec2
  WHERE ec2.calendar_id = ec.calendar_id
  ORDER BY ec2.sort_order, ec2.created_at
  LIMIT 1
);
