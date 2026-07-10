ALTER TABLE school_assignment_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_isolation ON school_assignment_materials;
CREATE POLICY household_isolation ON school_assignment_materials
  FOR ALL
  USING (EXISTS (
      SELECT 1 FROM school_assignments a
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE a.id = school_assignment_materials.assignment_id
        AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ))
  WITH CHECK (EXISTS (
      SELECT 1 FROM school_assignments a
      INNER JOIN school_classes p ON p.id = a.class_id
      WHERE a.id = school_assignment_materials.assignment_id
        AND p.household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
    ));
