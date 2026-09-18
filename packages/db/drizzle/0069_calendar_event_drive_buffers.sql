-- WHO-308: manual (non-geocoded) per-event drive-time buffers used by the Schedule Conflict
-- Checker to flag "yellow" (buffer-only) conflicts when this event's own padding encroaches on
-- a checked window. Nullable = no buffer configured (treated as 0 in conflict math).
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS drive_buffer_before_minutes integer;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS drive_buffer_after_minutes integer;
