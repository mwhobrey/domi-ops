-- Dashboard "Today at a glance" tile visibility + order, per member (TodayGlance.tsx). Null
-- means "no preference set" — defaults to showing every currently-available tile, sorted by
-- urgency, same as before this column existed.

ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "glance_config" text;
