-- Assistant calendar availability and a rolling-deploy guard (docs/MCP_ASSISTANT_ACTIONS_SPEC.md, stage 4).
-- A selection lets one connection learn when its member is busy on that calendar. Titles, locations,
-- attendees and calendar names never leave: the tool returns merged busy intervals only.
ALTER TABLE mcp_connections DROP CONSTRAINT mcp_connections_scopes_check;
ALTER TABLE mcp_connections ADD CONSTRAINT mcp_connections_scopes_check
 CHECK (scopes <@ ARRAY['shopping:read','chores:read','notes:read','health:read','calendar:read','shopping:write','chores:write','health:write','offline_access']::text[]);

CREATE TABLE mcp_calendar_selections (
 household_id uuid NOT NULL, connection_id uuid NOT NULL, user_id uuid NOT NULL,
 calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 consented_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (connection_id, calendar_id),
 FOREIGN KEY(household_id,connection_id,user_id) REFERENCES mcp_connections(household_id,id,user_id) ON DELETE CASCADE
);
ALTER TABLE mcp_calendar_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_selection_owner ON mcp_calendar_selections FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);

-- Set by every build that writes capability rows at consent. NULL on a new row means the grant was
-- prepared by an older API build during a rolling deploy, whose consent screen offered reads by scope.
ALTER TABLE mcp_connections ADD COLUMN capability_consent_version text
 CHECK (capability_consent_version IS NULL OR char_length(capability_consent_version) BETWEEN 1 AND 64);

-- Gives such a grant exactly the reads its member approved on the older screen, as 0108 did for
-- grants that already existed. It never switches on an action, health or calendar access.
-- Runs as the inserting role, so the capability table's own row-level policy still applies.
CREATE FUNCTION app.mcp_legacy_connection_capabilities() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 INSERT INTO public.mcp_connection_capabilities (household_id, connection_id, user_id, capability, consent_version)
 SELECT NEW.household_id, NEW.id, NEW.user_id, m.capability, 'legacy.build'
 FROM (VALUES ('shopping:read','shopping.read'),('chores:read','chores.read'),('notes:read','notes.read')) AS m(scope, capability)
 WHERE m.scope = ANY(NEW.scopes)
 ON CONFLICT (connection_id, capability) DO NOTHING;
 RETURN NULL;
END $$;
CREATE TRIGGER mcp_legacy_connection_capabilities AFTER INSERT ON mcp_connections FOR EACH ROW
 WHEN (NEW.capability_consent_version IS NULL AND NEW.status <> 'revoked')
 EXECUTE FUNCTION app.mcp_legacy_connection_capabilities();
