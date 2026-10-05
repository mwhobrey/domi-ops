-- Health event lookups by person, kind and time had only the primary key to go on, so each one scanned
-- the household's whole event history. Scheduled checks make that hot: the reminder worker, the slot
-- status API, the calendar, the dashboard and the new reports all ask "this person's vitals between
-- two instants" (a few readings a day adds up quickly), and the worker does it every 5 minutes per
-- check. One composite index serves all of them; household_id leads because row level security
-- filters on it for every query.

CREATE INDEX IF NOT EXISTS "health_events_household_member_type_started_idx"
  ON "health_events" ("household_id", "member_id", "type", "started_at");
