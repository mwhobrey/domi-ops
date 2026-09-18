-- WHO-312: pain body map gets a selectable spine (back view) and left/right chest (front view).
-- "chest" stays in the enum (Postgres can't cleanly drop an enum value) but the UI no longer
-- offers it. Any existing "chest" rows are not migrated: they keep the "Chest" label in lists and
-- report tables, they just aren't drawn on the map.
ALTER TYPE "health_pain_body_region" ADD VALUE IF NOT EXISTS 'left_chest';
ALTER TYPE "health_pain_body_region" ADD VALUE IF NOT EXISTS 'right_chest';
ALTER TYPE "health_pain_body_region" ADD VALUE IF NOT EXISTS 'spine';
