-- WHO-469: maintained provider schema; application grants are separate below.
CREATE TABLE mcp_jwks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key text NOT NULL,
  private_key text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  alg text,
  crv text
);
CREATE TABLE mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_secret text,
  client_discovery_id text,
  disabled boolean,
  skip_consent boolean,
  enable_end_session boolean,
  subject_type text,
  scopes text[],
  client_credentials_scopes text[],
  user_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  name text,
  uri text,
  icon text,
  contacts text[],
  tos text,
  policy text,
  software_id text,
  software_version text,
  software_statement text,
  redirect_uris text[] NOT NULL,
  post_logout_redirect_uris text[],
  backchannel_logout_uri text,
  backchannel_logout_session_required boolean,
  token_endpoint_auth_method text,
  application_type text,
  jwks text,
  jwks_uri text,
  grant_types text[],
  response_types text[],
  require_p_k_c_e boolean,
  dpop_bound_access_tokens boolean,
  reference_id text,
  metadata jsonb
);
CREATE TABLE mcp_oauth_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL UNIQUE,
  name text NOT NULL,
  access_token_ttl integer,
  refresh_token_ttl integer,
  signing_algorithm text,
  signing_key_id text,
  allowed_scopes text[],
  custom_claims jsonb,
  dpop_bound_access_tokens_required boolean,
  disabled boolean,
  created_at timestamptz,
  updated_at timestamptz,
  policy_version integer,
  metadata jsonb
);
CREATE TABLE mcp_oauth_client_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  resource_id text NOT NULL,
  metadata jsonb,
  created_at timestamptz
);
CREATE TABLE mcp_oauth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  client_id text NOT NULL,
  session_id uuid,
  user_id uuid NOT NULL,
  reference_id text,
  authorization_code_id text,
  resources text[],
  requested_user_info_claims text[],
  expires_at timestamptz,
  created_at timestamptz,
  revoked timestamptz,
  rotated_at timestamptz,
  rotation_replay_response text,
  rotation_replay_expires_at timestamptz,
  auth_time timestamptz,
  confirmation jsonb,
  scopes text[] NOT NULL
);
CREATE TABLE mcp_oauth_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE,
  client_id text NOT NULL,
  session_id uuid,
  user_id uuid,
  reference_id text,
  authorization_code_id text,
  resources text[],
  requested_user_info_claims text[],
  refresh_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  revoked timestamptz,
  confirmation jsonb,
  scopes text[] NOT NULL
);
CREATE TABLE mcp_oauth_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  user_id uuid,
  reference_id text,
  resources text[],
  requested_user_info_claims text[],
  scopes text[] NOT NULL,
  created_at timestamptz,
  updated_at timestamptz
);
CREATE TABLE mcp_oauth_client_assertions (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
ALTER TABLE mcp_oauth_clients ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade;
ALTER TABLE mcp_oauth_client_resources ADD FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE cascade;
ALTER TABLE mcp_oauth_client_resources ADD FOREIGN KEY (resource_id) REFERENCES mcp_oauth_resources(identifier) ON DELETE cascade;
ALTER TABLE mcp_oauth_refresh_tokens ADD FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE cascade;
ALTER TABLE mcp_oauth_refresh_tokens ADD FOREIGN KEY (session_id) REFERENCES ba_sessions(id) ON DELETE set null;
ALTER TABLE mcp_oauth_refresh_tokens ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade;
ALTER TABLE mcp_oauth_access_tokens ADD FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE cascade;
ALTER TABLE mcp_oauth_access_tokens ADD FOREIGN KEY (session_id) REFERENCES ba_sessions(id) ON DELETE set null;
ALTER TABLE mcp_oauth_access_tokens ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade;
ALTER TABLE mcp_oauth_access_tokens ADD FOREIGN KEY (refresh_id) REFERENCES mcp_oauth_refresh_tokens(id) ON DELETE cascade;
ALTER TABLE mcp_oauth_consents ADD FOREIGN KEY (client_id) REFERENCES mcp_oauth_clients(client_id) ON DELETE cascade;
ALTER TABLE mcp_oauth_consents ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade;

CREATE UNIQUE INDEX mcp_client_resource_unique ON mcp_oauth_client_resources(client_id, resource_id);
CREATE INDEX mcp_refresh_reference_idx ON mcp_oauth_refresh_tokens(reference_id);
CREATE INDEX mcp_access_reference_idx ON mcp_oauth_access_tokens(reference_id);
CREATE INDEX mcp_consent_reference_idx ON mcp_oauth_consents(reference_id);

CREATE TABLE mcp_client_profiles (
  client_id text PRIMARY KEY REFERENCES mcp_oauth_clients(client_id) ON DELETE cascade,
  provider text NOT NULL,
  version text NOT NULL,
  data_mode text NOT NULL CHECK (data_mode IN ('synthetic', 'household')),
  enabled boolean NOT NULL DEFAULT false
);

-- An explicit, non-login credential repository role; no domain/identity grants.
-- Migrations run as the operator. Restricted app membership is installed by db:create-app-role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domi_ops_oauth') THEN
    CREATE ROLE domi_ops_oauth NOLOGIN;
  END IF;
END $$;
GRANT domi_ops_oauth TO CURRENT_USER;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domi_ops_oauth' AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'domi_ops_oauth must be a non-login, non-superuser, NOBYPASSRLS role';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO domi_ops_oauth;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_jwks','mcp_oauth_clients','mcp_oauth_resources','mcp_oauth_client_resources',
    'mcp_oauth_refresh_tokens','mcp_oauth_access_tokens','mcp_oauth_consents','mcp_oauth_client_assertions','mcp_client_profiles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY provider_repository ON %I FOR ALL TO domi_ops_oauth USING (current_user = ''domi_ops_oauth'') WITH CHECK (current_user = ''domi_ops_oauth'')', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO domi_ops_oauth', t);
  END LOOP;
END $$;

CREATE UNIQUE INDEX household_members_mcp_identity ON household_members(household_id, id, user_id);
CREATE UNIQUE INDEX notes_mcp_household_identity ON notes(household_id, id);
CREATE TABLE mcp_household_settings (
  household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE cascade,
  enabled boolean NOT NULL DEFAULT false,
  updated_by_member_id uuid REFERENCES household_members(id) ON DELETE set null,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE cascade,
  member_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  client_id text NOT NULL REFERENCES mcp_oauth_clients(client_id),
  issuer text NOT NULL,
  resource text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  granted_role text NOT NULL CHECK (granted_role IN ('owner','admin','member')),
  scopes text[] NOT NULL,
  policy_version text NOT NULL,
  client_profile_version text NOT NULL,
  adult_attested_at timestamptz NOT NULL,
  privacy_attested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE(household_id, id),
  UNIQUE(household_id, id, user_id),
  FOREIGN KEY(household_id, member_id, user_id) REFERENCES household_members(household_id, id, user_id) ON DELETE cascade,
  CHECK (scopes <@ ARRAY['shopping:read','chores:read','notes:read','offline_access']::text[]),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX mcp_connections_user_idx ON mcp_connections(user_id, id);
CREATE TABLE mcp_note_selections (
  household_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  note_id uuid NOT NULL,
  selected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(connection_id, note_id),
  FOREIGN KEY(household_id, connection_id) REFERENCES mcp_connections(household_id, id) ON DELETE cascade,
  FOREIGN KEY(household_id, note_id) REFERENCES notes(household_id, id) ON DELETE cascade
);
CREATE TABLE mcp_pending_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  session_id uuid NOT NULL REFERENCES ba_sessions(id) ON DELETE cascade,
  client_id text NOT NULL,
  resource text NOT NULL,
  query_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE(session_id, query_hash),
  FOREIGN KEY(household_id, connection_id, user_id) REFERENCES mcp_connections(household_id, id, user_id) ON DELETE cascade
);
CREATE TABLE mcp_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  tool text NOT NULL,
  outcome text NOT NULL,
  request_id uuid NOT NULL,
  duration_ms integer,
  byte_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(household_id, connection_id, actor_user_id) REFERENCES mcp_connections(household_id, id, user_id) ON DELETE cascade
);
CREATE INDEX mcp_access_events_retention_idx ON mcp_access_events(created_at);

ALTER TABLE mcp_household_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON mcp_household_settings FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
ALTER TABLE mcp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY connection_owner ON mcp_connections FOR ALL
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    AND household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    AND household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
CREATE POLICY verified_reference_lookup ON mcp_connections FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    AND id = NULLIF(current_setting('app.mcp_connection_id', true), '')::uuid);
ALTER TABLE mcp_pending_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_owner ON mcp_pending_consents FOR ALL
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
ALTER TABLE mcp_note_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY connection_owner ON mcp_note_selections FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM mcp_connections c WHERE c.id = connection_id AND c.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid))
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM mcp_connections c WHERE c.id = connection_id AND c.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid));
ALTER TABLE mcp_access_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_owner ON mcp_access_events FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid AND actor_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid AND actor_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE FUNCTION app.mcp_immutable_connection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (NEW.id, NEW.household_id, NEW.member_id, NEW.user_id, NEW.client_id, NEW.issuer, NEW.resource,
      NEW.granted_role, NEW.policy_version, NEW.client_profile_version, NEW.adult_attested_at,
      NEW.privacy_attested_at, NEW.created_at, NEW.expires_at)
    IS DISTINCT FROM
     (OLD.id, OLD.household_id, OLD.member_id, OLD.user_id, OLD.client_id, OLD.issuer, OLD.resource,
      OLD.granted_role, OLD.policy_version, OLD.client_profile_version, OLD.adult_attested_at,
      OLD.privacy_attested_at, OLD.created_at, OLD.expires_at)
    OR NOT (NEW.scopes <@ OLD.scopes)
    OR (OLD.status = 'revoked' AND NEW.status <> 'revoked')
    OR (OLD.status = 'active' AND NEW.status = 'pending') THEN
    RAISE EXCEPTION 'MCP grants are immutable; create a new consent';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mcp_immutable_connection BEFORE UPDATE ON mcp_connections FOR EACH ROW EXECUTE FUNCTION app.mcp_immutable_connection();

-- Reinstating a member must never resurrect an old assistant token. The trigger has
-- only this fixed mutation, needs table-owner visibility, and accepts no SQL input.
CREATE FUNCTION app.mcp_revoke_member_connections() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN
  IF (OLD.role, OLD.access_revoked_at, OLD.user_id, OLD.household_id) IS DISTINCT FROM
     (NEW.role, NEW.access_revoked_at, NEW.user_id, NEW.household_id) THEN
    UPDATE public.mcp_connections SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
      WHERE member_id = OLD.id AND status <> 'revoked';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.mcp_revoke_member_connections() FROM PUBLIC;
CREATE TRIGGER mcp_member_access_change AFTER UPDATE ON household_members FOR EACH ROW EXECUTE FUNCTION app.mcp_revoke_member_connections();

CREATE FUNCTION app.mcp_revoke_household_connections() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN
  IF OLD.enabled AND NOT NEW.enabled THEN
    UPDATE public.mcp_connections SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
      WHERE household_id = NEW.household_id AND status <> 'revoked';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.mcp_revoke_household_connections() FROM PUBLIC;
CREATE TRIGGER mcp_household_disable AFTER UPDATE ON mcp_household_settings FOR EACH ROW EXECUTE FUNCTION app.mcp_revoke_household_connections();

-- Rotation marks both revoked and rotated_at. Explicit revocation has no
-- rotated_at, while replay/family invalidation deletes rows. Both must deny
-- already-issued JWTs through the application grant as well as future refresh.
CREATE FUNCTION app.mcp_provider_revocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.mcp_connections SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
      WHERE id::text = OLD.reference_id AND user_id = OLD.user_id AND client_id = OLD.client_id AND status <> 'revoked';
    RETURN OLD;
  END IF;
  IF OLD.revoked IS NULL AND NEW.revoked IS NOT NULL AND NEW.rotated_at IS NULL THEN
    UPDATE public.mcp_connections SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
      WHERE id::text = NEW.reference_id AND user_id = NEW.user_id AND client_id = NEW.client_id AND status <> 'revoked';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.mcp_provider_revocation() FROM PUBLIC;
CREATE TRIGGER mcp_refresh_revoke AFTER UPDATE OR DELETE ON mcp_oauth_refresh_tokens FOR EACH ROW EXECUTE FUNCTION app.mcp_provider_revocation();
