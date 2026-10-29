ALTER TABLE shopping_items ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE chores ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE mcp_connections DROP CONSTRAINT mcp_connections_scopes_check;
ALTER TABLE mcp_connections ADD CONSTRAINT mcp_connections_scopes_check
 CHECK (scopes <@ ARRAY['shopping:read','chores:read','notes:read','shopping:write','chores:write','offline_access']::text[]);
CREATE FUNCTION app.bump_record_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision := OLD.revision + 1; RETURN NEW; END $$;
CREATE TRIGGER shopping_revision BEFORE UPDATE ON shopping_items FOR EACH ROW EXECUTE FUNCTION app.bump_record_revision();
CREATE TRIGGER chores_revision BEFORE UPDATE ON chores FOR EACH ROW EXECUTE FUNCTION app.bump_record_revision();

CREATE TABLE mcp_write_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, user_id uuid NOT NULL, member_id uuid NOT NULL,
 connection_id uuid NOT NULL, client_id text NOT NULL,
 operation text NOT NULL, operation_version text NOT NULL, scope text NOT NULL CHECK (scope IN ('shopping:write','chores:write')),
 policy_version text NOT NULL, profile_version text NOT NULL, granted_role text NOT NULL,
 key_hash text NOT NULL, request_digest text NOT NULL, preview_digest text NOT NULL,
 envelope text, state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','committed','rejected','stale','expired')),
 review_session_hash text, review_nonce_hash text, receipt_id uuid, confirmed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 FOREIGN KEY(household_id,connection_id,user_id) REFERENCES mcp_connections(household_id,id,user_id) ON DELETE CASCADE,
 CONSTRAINT mcp_write_intent_key UNIQUE(connection_id,key_hash),
 CONSTRAINT mcp_write_intent_owner UNIQUE(household_id,id,user_id,connection_id),
 CHECK (expires_at <= created_at + interval '5 minutes'),
 CHECK ((state='committed' AND receipt_id IS NOT NULL AND confirmed_at IS NOT NULL) OR (state<>'committed' AND receipt_id IS NULL AND confirmed_at IS NULL)),
 CHECK (envelope IS NULL OR octet_length(envelope) <= 65536)
);
CREATE INDEX mcp_write_intent_expiry ON mcp_write_intents(expires_at);
CREATE TABLE mcp_write_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, user_id uuid NOT NULL,
 connection_id uuid NOT NULL, intent_id uuid NOT NULL, outcome text NOT NULL CHECK (outcome IN ('prepared','committed','rejected','stale','expired')), session_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(household_id,intent_id,user_id,connection_id) REFERENCES mcp_write_intents(household_id,id,user_id,connection_id) ON DELETE CASCADE
);
CREATE INDEX mcp_write_event_intent ON mcp_write_events(intent_id);
ALTER TABLE mcp_write_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_write_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY intent_owner ON mcp_write_intents FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY event_owner ON mcp_write_events FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);

CREATE FUNCTION app.mcp_prune_write_metadata() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer; total integer := 0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(731043,479) THEN RETURN 0; END IF;
 UPDATE public.mcp_write_intents SET envelope=NULL, review_nonce_hash=NULL, review_session_hash=NULL,
  state=CASE WHEN state='pending' THEN 'expired' ELSE state END
  WHERE id IN (SELECT id FROM public.mcp_write_intents WHERE expires_at < now() AND state='pending' AND envelope IS NOT NULL ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
 DELETE FROM public.mcp_write_intents WHERE id IN (SELECT id FROM public.mcp_write_intents WHERE created_at < now()-interval '30 days' ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n = ROW_COUNT; RETURN total+n;
END $$;
REVOKE ALL ON FUNCTION app.mcp_prune_write_metadata() FROM PUBLIC;
