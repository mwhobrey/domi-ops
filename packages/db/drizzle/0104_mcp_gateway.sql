CREATE TABLE mcp_household_windows (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  bucket timestamptz NOT NULL,
  calls integer NOT NULL DEFAULT 0 CHECK (calls BETWEEN 0 AND 120),
  PRIMARY KEY (household_id, bucket)
);
CREATE TABLE mcp_connection_windows (
  household_id uuid NOT NULL, user_id uuid NOT NULL, connection_id uuid NOT NULL,
  bucket timestamptz NOT NULL,
  calls integer NOT NULL DEFAULT 0 CHECK (calls BETWEEN 0 AND 30),
  throttled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (connection_id, bucket),
  FOREIGN KEY(household_id, connection_id, user_id) REFERENCES mcp_connections(household_id, id, user_id) ON DELETE CASCADE
);
CREATE TABLE mcp_request_leases (
  id uuid PRIMARY KEY, household_id uuid NOT NULL, user_id uuid NOT NULL, connection_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(household_id, connection_id, user_id) REFERENCES mcp_connections(household_id, id, user_id) ON DELETE CASCADE
);
CREATE INDEX mcp_request_leases_connection_idx ON mcp_request_leases(connection_id, expires_at);
CREATE INDEX mcp_access_events_connection_idx ON mcp_access_events(connection_id, created_at);
CREATE INDEX mcp_refresh_reference_retention_idx ON mcp_oauth_refresh_tokens(reference_id, expires_at);
CREATE INDEX mcp_pending_expiry_idx ON mcp_pending_consents(expires_at);
CREATE INDEX mcp_connection_windows_retention_idx ON mcp_connection_windows(bucket);
CREATE INDEX mcp_household_windows_retention_idx ON mcp_household_windows(bucket);
CREATE INDEX mcp_request_leases_retention_idx ON mcp_request_leases(expires_at);
CREATE INDEX mcp_connections_retention_idx ON mcp_connections(status, expires_at);
ALTER TABLE mcp_household_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON mcp_household_windows FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
ALTER TABLE mcp_connection_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY connection_owner ON mcp_connection_windows FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
ALTER TABLE mcp_request_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY connection_owner ON mcp_request_leases FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Fixed, bounded metadata deletion only. No worker-scan/system policy exposes grants
-- or credentials. No arguments can select a tenant, change a TTL or return content.
CREATE FUNCTION app.mcp_prune_expired_metadata() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE total integer := 0; n integer; expired_ids uuid[];
BEGIN
  -- Multiple workers can run the scheduler; a busy sweep needs no duplicate work.
  IF NOT pg_try_advisory_xact_lock(731043, 471) THEN RETURN 0; END IF;
  DELETE FROM public.mcp_access_events WHERE id IN
    (SELECT id FROM public.mcp_access_events WHERE created_at < now() - interval '30 days' ORDER BY created_at LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.mcp_pending_consents WHERE id IN
    (SELECT id FROM public.mcp_pending_consents WHERE expires_at < now() ORDER BY expires_at LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.mcp_request_leases WHERE id IN
    (SELECT id FROM public.mcp_request_leases WHERE expires_at < now() ORDER BY expires_at LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.mcp_connection_windows WHERE (connection_id, bucket) IN
    (SELECT connection_id, bucket FROM public.mcp_connection_windows WHERE bucket < now() - interval '2 minutes' ORDER BY bucket LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.mcp_household_windows WHERE (household_id, bucket) IN
    (SELECT household_id, bucket FROM public.mcp_household_windows WHERE bucket < now() - interval '2 minutes' ORDER BY bucket LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  UPDATE public.mcp_connections SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()) WHERE id IN
    (SELECT id FROM public.mcp_connections WHERE expires_at < now() AND status <> 'revoked' ORDER BY expires_at LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  SELECT array_agg(c.id) INTO expired_ids FROM
    (SELECT c.id FROM public.mcp_connections c WHERE c.status = 'revoked' AND c.expires_at < now()
      AND c.revoked_at < now() - interval '5 minutes'
      AND NOT EXISTS (SELECT 1 FROM public.mcp_access_events e WHERE e.connection_id = c.id)
      -- Drain historical windows/leases in their bounded batches before the FK
      -- cascade, including when a worker has been offline for a long period.
      AND NOT EXISTS (SELECT 1 FROM public.mcp_connection_windows w WHERE w.connection_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.mcp_request_leases l WHERE l.connection_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.mcp_oauth_refresh_tokens r WHERE r.reference_id = c.id::text AND (r.expires_at IS NULL OR r.expires_at >= now()))
      AND NOT EXISTS (SELECT 1 FROM public.mcp_oauth_access_tokens a WHERE a.reference_id = c.id::text AND (a.expires_at IS NULL OR a.expires_at >= now()))
      ORDER BY c.expires_at LIMIT 1000) c;
  -- Deleting old rotated refresh rows of an active grant would trigger family
  -- revocation. Purge credentials only for grants already eligible for deletion.
  DELETE FROM public.mcp_oauth_consents WHERE id IN (SELECT id FROM public.mcp_oauth_consents WHERE reference_id = ANY(SELECT unnest(expired_ids)::text) LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.mcp_oauth_access_tokens WHERE id IN (SELECT id FROM public.mcp_oauth_access_tokens WHERE reference_id = ANY(SELECT unnest(expired_ids)::text) LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.mcp_oauth_refresh_tokens WHERE id IN (SELECT r.id FROM public.mcp_oauth_refresh_tokens r WHERE reference_id = ANY(SELECT unnest(expired_ids)::text)
    AND NOT EXISTS (SELECT 1 FROM public.mcp_oauth_access_tokens a WHERE a.refresh_id = r.id) LIMIT 1000);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.mcp_connections c WHERE id = ANY(expired_ids)
    AND NOT EXISTS (SELECT 1 FROM public.mcp_oauth_consents p WHERE p.reference_id = c.id::text)
    AND NOT EXISTS (SELECT 1 FROM public.mcp_oauth_access_tokens a WHERE a.reference_id = c.id::text)
    AND NOT EXISTS (SELECT 1 FROM public.mcp_oauth_refresh_tokens r WHERE r.reference_id = c.id::text);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN total + n;
END $$;
REVOKE ALL ON FUNCTION app.mcp_prune_expired_metadata() FROM PUBLIC;
