ALTER TABLE household_members ADD COLUMN access_revoked_at timestamp with time zone;
CREATE TABLE household_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE cascade,
  email text NOT NULL,
  role member_role DEFAULT 'member' NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
  token_hash text NOT NULL,
  created_by_member_id uuid REFERENCES household_members(id) ON DELETE set null,
  accepted_by_user_id uuid REFERENCES users(id) ON DELETE set null,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX household_invitations_token_hash ON household_invitations(token_hash);
ALTER TABLE household_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_isolation ON household_invitations FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
CREATE POLICY system_bootstrap ON household_invitations FOR ALL
  USING (current_setting('app.system_access', true) = 'true')
  WITH CHECK (current_setting('app.system_access', true) = 'true');
