-- Assistant access to medication groups (docs/MCP_ASSISTANT_ACTIONS_SPEC.md, stage 2).
-- A selection shares a group's label, times and logging status with one connection. Medication
-- names never leave: the assistant refers to an occurrence, and Domi Ops resolves it.
ALTER TABLE mcp_connections DROP CONSTRAINT mcp_connections_scopes_check;
ALTER TABLE mcp_connections ADD CONSTRAINT mcp_connections_scopes_check
 CHECK (scopes <@ ARRAY['shopping:read','chores:read','notes:read','health:read','shopping:write','chores:write','health:write','offline_access']::text[]);

CREATE TABLE mcp_med_group_selections (
 household_id uuid NOT NULL, connection_id uuid NOT NULL, user_id uuid NOT NULL,
 group_id uuid NOT NULL REFERENCES health_medication_groups(id) ON DELETE CASCADE,
 can_log boolean NOT NULL DEFAULT false,
 share_counts boolean NOT NULL DEFAULT true,
 -- Optional replacement for the group name, stored like other health text.
 label_alias text CHECK (label_alias IS NULL OR octet_length(label_alias) <= 1024),
 consented_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (connection_id, group_id),
 FOREIGN KEY(household_id,connection_id,user_id) REFERENCES mcp_connections(household_id,id,user_id) ON DELETE CASCADE
);
-- Approval covers the medications in a group when the member consented. A member medication with
-- no row here was added later and is not approved. Removing a medication from its group deletes
-- its row through the second foreign key, so adding it back needs approval again.
CREATE TABLE mcp_med_group_member_consents (
 household_id uuid NOT NULL, connection_id uuid NOT NULL, user_id uuid NOT NULL,
 group_id uuid NOT NULL, medication_id uuid NOT NULL,
 state text NOT NULL CHECK (state IN ('approved','excluded')),
 consented_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (connection_id, group_id, medication_id),
 FOREIGN KEY(connection_id, group_id) REFERENCES mcp_med_group_selections(connection_id, group_id) ON DELETE CASCADE,
 FOREIGN KEY(group_id, medication_id) REFERENCES health_medication_group_members(group_id, medication_id) ON DELETE CASCADE,
 FOREIGN KEY(household_id,connection_id,user_id) REFERENCES mcp_connections(household_id,id,user_id) ON DELETE CASCADE
);
CREATE INDEX mcp_med_group_member_consents_member_idx ON mcp_med_group_member_consents(group_id, medication_id);

-- Lets dose history say an assistant recorded the entry. The member stays logged_by_user_id.
ALTER TABLE health_medication_logs ADD COLUMN logged_via_connection_id uuid REFERENCES mcp_connections(id) ON DELETE SET NULL;

ALTER TABLE mcp_med_group_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_med_group_member_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY selection_owner ON mcp_med_group_selections FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);
CREATE POLICY consent_owner ON mcp_med_group_member_consents FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id',true),'')::uuid AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);
