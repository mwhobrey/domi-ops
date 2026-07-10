ALTER TABLE school_test_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_test_questions;
CREATE POLICY household_isolation ON school_test_questions
  FOR ALL
  USING (EXISTS (
      SELECT 1 FROM school_assignment_materials m
      INNER JOIN school_assignments a ON a.id = m.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE m.id = school_test_questions.material_id
        AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ))
  WITH CHECK (EXISTS (
      SELECT 1 FROM school_assignment_materials m
      INNER JOIN school_assignments a ON a.id = m.assignment_id
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE m.id = school_test_questions.material_id
        AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ));

DROP POLICY IF EXISTS worker_scan ON school_test_questions;
CREATE POLICY worker_scan ON school_test_questions
  FOR ALL
  USING (current_setting('app.worker_scan', true) = 'true')
  WITH CHECK (current_setting('app.worker_scan', true) = 'true');
