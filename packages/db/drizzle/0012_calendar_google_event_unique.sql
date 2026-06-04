DELETE FROM "calendar_events" AS dup
WHERE dup."id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "household_id", "google_event_id"
        ORDER BY "updated_at" DESC, "id" ASC
      ) AS rn
    FROM "calendar_events"
    WHERE "google_event_id" IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_events_household_google_event_id"
  ON "calendar_events" ("household_id", "google_event_id")
  WHERE "google_event_id" IS NOT NULL;
