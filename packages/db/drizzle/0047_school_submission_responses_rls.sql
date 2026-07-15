ALTER TABLE school_submission_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_submission_responses;
CREATE POLICY household_isolation ON school_submission_responses
  FOR ALL
  USING (EXISTS (
      SELECT 1 FROM school_submissions s
      INNER JOIN school_assignments a ON a.id = s.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE s.id = school_submission_responses.submission_id
        AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ))
  WITH CHECK (EXISTS (
      SELECT 1 FROM school_submissions s
      INNER JOIN school_assignments a ON a.id = s.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE s.id = school_submission_responses.submission_id
        AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ));

DROP POLICY IF EXISTS worker_scan ON school_submission_responses;
CREATE POLICY worker_scan ON school_submission_responses
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
