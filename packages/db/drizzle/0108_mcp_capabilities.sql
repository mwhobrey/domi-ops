-- Assistant capabilities and direct-action activity (docs/MCP_ASSISTANT_ACTIONS_SPEC.md, stage 0).
-- A scope is the outer bound of a grant; a row here is what its member actually switched on.
CREATE TABLE mcp_connection_capabilities (
 household_id uuid NOT NULL, connection_id uuid NOT NULL, user_id uuid NOT NULL,
 capability text NOT NULL CHECK (capability ~ '^[a-z_]{1,24}(\.[a-z_]{1,24}){1,2}$'),
 detail_level text CHECK (detail_level IS NULL OR detail_level ~ '^[a-z_]{1,32}$'),
 consent_version text NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 64),
 enabled_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (connection_id, capability),
 FOREIGN KEY(household_id,connection_id,user_id) REFERENCES mcp_connections(household_id,id,user_id) ON DELETE CASCADE
);
-- Existing grants keep exactly the reads they already hold. They gain no action.
INSERT INTO mcp_connection_capabilities (household_id, connection_id, user_id, capability, consent_version)
SELECT c.household_id, c.id, c.user_id, m.capability, 'backfill.0108'
FROM mcp_connections c
JOIN (VALUES ('shopping:read','shopping.read'),('chores:read','chores.read'),('notes:read','notes.read')) AS m(scope, capability)
  ON m.scope = ANY(c.scopes)
WHERE c.status <> 'revoked'
ON CONFLICT (connection_id, capability) DO NOTHING;
-- Member-visible record of what an assistant did. Never sent to a provider; no labels, titles or arguments.
CREATE TABLE mcp_action_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, user_id uuid NOT NULL, connection_id uuid NOT NULL,
 action text NOT NULL CHECK (action ~ '^[a-z_]{1,24}(\.[a-z_]{1,24}){1,2}$'),
 outcome text NOT NULL CHECK (outcome ~ '^[a-z_]{1,32}$'),
 counts jsonb CHECK (counts IS NULL OR (jsonb_typeof(counts) = 'object' AND octet_length(counts::text) <= 512)),
 target_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(household_id,connection_id,user_id) REFERENCES mcp_connections(household_id,id,user_id) ON DELETE CASCADE
);
CREATE INDEX mcp_action_events_connection_idx ON mcp_action_events(connection_id, created_at);
CREATE INDEX mcp_action_events_retention_idx ON mcp_action_events(created_at);
ALTER TABLE mcp_connection_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_action_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY capability_owner ON mcp_connection_capabilities FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY action_event_owner ON mcp_action_events FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);
CREATE FUNCTION app.mcp_prune_action_events() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(731043,108) THEN RETURN 0; END IF;
 DELETE FROM public.mcp_action_events WHERE id IN
  (SELECT id FROM public.mcp_action_events WHERE created_at < now() - interval '90 days' ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.mcp_prune_action_events() FROM PUBLIC;
