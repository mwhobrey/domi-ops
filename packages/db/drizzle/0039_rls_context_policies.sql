-- WHO-196: Supplemental RLS policies for auth lookup, bootstrap, and worker scans.
-- OR-combined with household_isolation from 0038 (PERMISSIVE policies).

-- Auth middleware: resolve household_members by user_id before tenant context.
DROP POLICY IF EXISTS member_auth_lookup ON household_members;
CREATE POLICY member_auth_lookup ON household_members
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Greenfield bootstrap / CLI (withSystemContext).
DROP POLICY IF EXISTS system_bootstrap ON households;
CREATE POLICY system_bootstrap ON households
  FOR ALL
  USING (current_setting('app.system_access', true) = 'true')
  WITH CHECK (current_setting('app.system_access', true) = 'true');

DROP POLICY IF EXISTS system_bootstrap ON household_members;
CREATE POLICY system_bootstrap ON household_members
  FOR ALL
  USING (current_setting('app.system_access', true) = 'true')
  WITH CHECK (current_setting('app.system_access', true) = 'true');

-- Trusted worker cross-tenant scans (withWorkerScanContext).
DROP POLICY IF EXISTS worker_scan ON households;
CREATE POLICY worker_scan ON households
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON household_members;
CREATE POLICY worker_scan ON household_members
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON household_subscriptions;
CREATE POLICY worker_scan ON household_subscriptions
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON import_records;
CREATE POLICY worker_scan ON import_records
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON calendars;
CREATE POLICY worker_scan ON calendars
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON calendar_events;
CREATE POLICY worker_scan ON calendar_events
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON event_categories;
CREATE POLICY worker_scan ON event_categories
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON calendar_event_reminders;
CREATE POLICY worker_scan ON calendar_event_reminders
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON recurring_rules;
CREATE POLICY worker_scan ON recurring_rules
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON calendar_connections;
CREATE POLICY worker_scan ON calendar_connections
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON shopping_recurring;
CREATE POLICY worker_scan ON shopping_recurring
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON expenses;
CREATE POLICY worker_scan ON expenses
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON expense_budgets;
CREATE POLICY worker_scan ON expense_budgets
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON expense_budget_alert_sent;
CREATE POLICY worker_scan ON expense_budget_alert_sent
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON shopping_trips;
CREATE POLICY worker_scan ON shopping_trips
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON shopping_items;
CREATE POLICY worker_scan ON shopping_items
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON chores_recurring;
CREATE POLICY worker_scan ON chores_recurring
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON chores;
CREATE POLICY worker_scan ON chores
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON chore_completions;
CREATE POLICY worker_scan ON chore_completions
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON chore_member_karma;
CREATE POLICY worker_scan ON chore_member_karma
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON notes;
CREATE POLICY worker_scan ON notes
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON notices;
CREATE POLICY worker_scan ON notices
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON home_status;
CREATE POLICY worker_scan ON home_status
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON drive_folders;
CREATE POLICY worker_scan ON drive_folders
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON drive_objects;
CREATE POLICY worker_scan ON drive_objects
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON google_docs_connections;
CREATE POLICY worker_scan ON google_docs_connections
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON health_events;
CREATE POLICY worker_scan ON health_events
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON health_medications;
CREATE POLICY worker_scan ON health_medications
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON user_notifications;
CREATE POLICY worker_scan ON user_notifications
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON school_classes;
CREATE POLICY worker_scan ON school_classes
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON calendar_shares;
CREATE POLICY worker_scan ON calendar_shares
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON linked_google_calendars;
CREATE POLICY worker_scan ON linked_google_calendars
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON calendar_category_import_mappings;
CREATE POLICY worker_scan ON calendar_category_import_mappings
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON calendar_sync_outbox;
CREATE POLICY worker_scan ON calendar_sync_outbox
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON school_enrollments;
CREATE POLICY worker_scan ON school_enrollments
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON school_assignment_categories;
CREATE POLICY worker_scan ON school_assignment_categories
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON school_assignments;
CREATE POLICY worker_scan ON school_assignments
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON school_submissions;
CREATE POLICY worker_scan ON school_submissions
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON school_grades;
CREATE POLICY worker_scan ON school_grades
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON school_submission_artifacts;
CREATE POLICY worker_scan ON school_submission_artifacts
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON school_attendance;
CREATE POLICY worker_scan ON school_attendance
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON drive_shares;
CREATE POLICY worker_scan ON drive_shares
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON drive_references;
CREATE POLICY worker_scan ON drive_references
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON drive_share_tokens;
CREATE POLICY worker_scan ON drive_share_tokens
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON note_shares;
CREATE POLICY worker_scan ON note_shares
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON notice_reads;
CREATE POLICY worker_scan ON notice_reads
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON shopping_trip_items;
CREATE POLICY worker_scan ON shopping_trip_items
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON health_event_shares;
CREATE POLICY worker_scan ON health_event_shares
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON health_medication_shares;
CREATE POLICY worker_scan ON health_medication_shares
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON health_medication_logs;
CREATE POLICY worker_scan ON health_medication_logs
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');

DROP POLICY IF EXISTS worker_scan ON health_med_reminder_sent;
CREATE POLICY worker_scan ON health_med_reminder_sent
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
