-- WHO-195: Row Level Security for Hosted Starter (DEPLOYMENT_MODE=shared)
-- Requires SET LOCAL app.current_household_id = '<uuid>' per transaction (WHO-196).
-- Excluded (auth / global identity): users, ba_sessions, ba_accounts, ba_verifications,
--   auth_sessions, oauth_accounts, push_subscriptions — API-scoped; revisit in WHO-197.
-- Superuser / BYPASSRLS roles (migrations) bypass RLS. Production app role must NOT bypass.

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.tenant_household_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_household_id', true), '')::uuid;
$$;

-- households: tenant row is the household itself
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON households;
CREATE POLICY household_isolation ON households
  FOR ALL
  USING (id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON household_members;
CREATE POLICY household_isolation ON household_members
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE household_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON household_subscriptions;
CREATE POLICY household_isolation ON household_subscriptions
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE import_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON import_records;
CREATE POLICY household_isolation ON import_records
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON calendars;
CREATE POLICY household_isolation ON calendars
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON calendar_events;
CREATE POLICY household_isolation ON calendar_events
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON event_categories;
CREATE POLICY household_isolation ON event_categories
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE calendar_event_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON calendar_event_reminders;
CREATE POLICY household_isolation ON calendar_event_reminders
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE recurring_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON recurring_rules;
CREATE POLICY household_isolation ON recurring_rules
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON calendar_connections;
CREATE POLICY household_isolation ON calendar_connections
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE shopping_recurring ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON shopping_recurring;
CREATE POLICY household_isolation ON shopping_recurring
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON expenses;
CREATE POLICY household_isolation ON expenses
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE expense_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON expense_budgets;
CREATE POLICY household_isolation ON expense_budgets
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE expense_budget_alert_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON expense_budget_alert_sent;
CREATE POLICY household_isolation ON expense_budget_alert_sent
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE shopping_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON shopping_trips;
CREATE POLICY household_isolation ON shopping_trips
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE shopping_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON shopping_items;
CREATE POLICY household_isolation ON shopping_items
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE chores_recurring ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON chores_recurring;
CREATE POLICY household_isolation ON chores_recurring
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE chores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON chores;
CREATE POLICY household_isolation ON chores
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE chore_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON chore_completions;
CREATE POLICY household_isolation ON chore_completions
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE chore_member_karma ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON chore_member_karma;
CREATE POLICY household_isolation ON chore_member_karma
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON notes;
CREATE POLICY household_isolation ON notes
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON notices;
CREATE POLICY household_isolation ON notices
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE home_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON home_status;
CREATE POLICY household_isolation ON home_status
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE drive_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON drive_folders;
CREATE POLICY household_isolation ON drive_folders
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE drive_objects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON drive_objects;
CREATE POLICY household_isolation ON drive_objects
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE google_docs_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON google_docs_connections;
CREATE POLICY household_isolation ON google_docs_connections
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE health_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_events;
CREATE POLICY household_isolation ON health_events
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE health_medications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_medications;
CREATE POLICY household_isolation ON health_medications
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON user_notifications;
CREATE POLICY household_isolation ON user_notifications
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE school_classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_classes;
CREATE POLICY household_isolation ON school_classes
  FOR ALL
  USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);

ALTER TABLE calendar_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON calendar_shares;
CREATE POLICY household_isolation ON calendar_shares
  FOR ALL
  USING (EXISTS (SELECT 1 FROM calendars p WHERE p.id = calendar_shares.calendar_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM calendars p WHERE p.id = calendar_shares.calendar_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE linked_google_calendars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON linked_google_calendars;
CREATE POLICY household_isolation ON linked_google_calendars
  FOR ALL
  USING (EXISTS (SELECT 1 FROM calendar_connections p WHERE p.id = linked_google_calendars.connection_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_connections p WHERE p.id = linked_google_calendars.connection_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE calendar_category_import_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON calendar_category_import_mappings;
CREATE POLICY household_isolation ON calendar_category_import_mappings
  FOR ALL
  USING (EXISTS (SELECT 1 FROM calendar_connections p WHERE p.id = calendar_category_import_mappings.connection_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_connections p WHERE p.id = calendar_category_import_mappings.connection_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE calendar_sync_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON calendar_sync_outbox;
CREATE POLICY household_isolation ON calendar_sync_outbox
  FOR ALL
  USING (EXISTS (SELECT 1 FROM calendar_events p WHERE p.id = calendar_sync_outbox.event_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events p WHERE p.id = calendar_sync_outbox.event_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE school_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_enrollments;
CREATE POLICY household_isolation ON school_enrollments
  FOR ALL
  USING (EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_enrollments.class_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_enrollments.class_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE school_assignment_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_assignment_categories;
CREATE POLICY household_isolation ON school_assignment_categories
  FOR ALL
  USING (EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_assignment_categories.class_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_assignment_categories.class_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE school_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_assignments;
CREATE POLICY household_isolation ON school_assignments
  FOR ALL
  USING (EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_assignments.class_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_assignments.class_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE school_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_submissions;
CREATE POLICY household_isolation ON school_submissions
  FOR ALL
  USING (EXISTS (
      SELECT 1 FROM school_assignments a
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE a.id = school_submissions.assignment_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ))
  WITH CHECK (EXISTS (
      SELECT 1 FROM school_assignments a
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE a.id = school_submissions.assignment_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ));

ALTER TABLE school_grades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_grades;
CREATE POLICY household_isolation ON school_grades
  FOR ALL
  USING (EXISTS (
      SELECT 1 FROM school_submissions s
      INNER JOIN school_assignments a ON a.id = s.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE s.id = school_grades.submission_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ))
  WITH CHECK (EXISTS (
      SELECT 1 FROM school_submissions s
      INNER JOIN school_assignments a ON a.id = s.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE s.id = school_grades.submission_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ));

ALTER TABLE school_submission_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_submission_artifacts;
CREATE POLICY household_isolation ON school_submission_artifacts
  FOR ALL
  USING (EXISTS (
      SELECT 1 FROM school_submissions s
      INNER JOIN school_assignments a ON a.id = s.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE s.id = school_submission_artifacts.submission_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ))
  WITH CHECK (EXISTS (
      SELECT 1 FROM school_submissions s
      INNER JOIN school_assignments a ON a.id = s.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE s.id = school_submission_artifacts.submission_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ));

ALTER TABLE school_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_attendance;
CREATE POLICY household_isolation ON school_attendance
  FOR ALL
  USING (EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_attendance.class_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM school_classes p WHERE p.id = school_attendance.class_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE drive_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON drive_shares;
CREATE POLICY household_isolation ON drive_shares
  FOR ALL
  USING (EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_shares.drive_object_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_shares.drive_object_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE drive_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON drive_references;
CREATE POLICY household_isolation ON drive_references
  FOR ALL
  USING (EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_references.drive_object_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_references.drive_object_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE drive_share_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON drive_share_tokens;
CREATE POLICY household_isolation ON drive_share_tokens
  FOR ALL
  USING (EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_share_tokens.drive_object_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM drive_objects p WHERE p.id = drive_share_tokens.drive_object_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE note_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON note_shares;
CREATE POLICY household_isolation ON note_shares
  FOR ALL
  USING (EXISTS (SELECT 1 FROM notes p WHERE p.id = note_shares.note_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM notes p WHERE p.id = note_shares.note_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON notice_reads;
CREATE POLICY household_isolation ON notice_reads
  FOR ALL
  USING (EXISTS (SELECT 1 FROM notices p WHERE p.id = notice_reads.notice_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM notices p WHERE p.id = notice_reads.notice_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE shopping_trip_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON shopping_trip_items;
CREATE POLICY household_isolation ON shopping_trip_items
  FOR ALL
  USING (EXISTS (SELECT 1 FROM shopping_trips p WHERE p.id = shopping_trip_items.trip_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM shopping_trips p WHERE p.id = shopping_trip_items.trip_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE health_event_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_event_shares;
CREATE POLICY household_isolation ON health_event_shares
  FOR ALL
  USING (EXISTS (SELECT 1 FROM health_events p WHERE p.id = health_event_shares.event_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_events p WHERE p.id = health_event_shares.event_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE health_medication_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_medication_shares;
CREATE POLICY household_isolation ON health_medication_shares
  FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_shares.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_shares.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE health_medication_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_medication_logs;
CREATE POLICY household_isolation ON health_medication_logs
  FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_logs.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_medication_logs.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));

ALTER TABLE health_med_reminder_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON health_med_reminder_sent;
CREATE POLICY household_isolation ON health_med_reminder_sent
  FOR ALL
  USING (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_med_reminder_sent.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM health_medications p WHERE p.id = health_med_reminder_sent.medication_id AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid));
