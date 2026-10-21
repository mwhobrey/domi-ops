ALTER TABLE calendar_sync_outbox ADD COLUMN household_id uuid;
ALTER TABLE calendar_sync_outbox ADD COLUMN connection_id uuid;
UPDATE calendar_sync_outbox o
SET household_id = e.household_id, connection_id = c.id
FROM calendar_events e, linked_google_calendars l, calendar_connections c
WHERE o.event_id = e.id AND (CASE WHEN o.payload_json IS JSON OBJECT THEN o.payload_json::jsonb ->> 'linkedCalendarId' END) = l.id::text
  AND l.connection_id = c.id AND c.household_id = e.household_id;
-- Legacy orphan intents cannot be delivered by the old worker either.
DELETE FROM calendar_sync_outbox WHERE household_id IS NULL OR connection_id IS NULL;
ALTER TABLE calendar_sync_outbox ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE calendar_sync_outbox ALTER COLUMN connection_id SET NOT NULL;
ALTER TABLE calendar_sync_outbox ADD CONSTRAINT calendar_sync_outbox_household_id_households_id_fk
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE calendar_sync_outbox ADD CONSTRAINT calendar_sync_outbox_connection_id_calendar_connections_id_fk
  FOREIGN KEY (connection_id) REFERENCES calendar_connections(id) ON DELETE CASCADE;
ALTER TABLE calendar_sync_outbox DROP CONSTRAINT calendar_sync_outbox_event_id_calendar_events_id_fk;
ALTER TABLE calendar_sync_outbox ADD CONSTRAINT calendar_sync_outbox_event_id_calendar_events_id_fk
  FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE SET NULL;
CREATE INDEX calendar_sync_outbox_connection_created ON calendar_sync_outbox(connection_id, created_at);
DROP POLICY household_isolation ON calendar_sync_outbox;
CREATE POLICY household_isolation ON calendar_sync_outbox FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (
    household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM calendar_connections c
      WHERE c.id = connection_id AND c.household_id = calendar_sync_outbox.household_id)
    AND (event_id IS NULL OR EXISTS (SELECT 1 FROM calendar_events e
      WHERE e.id = event_id AND e.household_id = calendar_sync_outbox.household_id))
  );
