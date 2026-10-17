-- These modules predated hosted tenant policies. Keep their scans tenant-scoped.
ALTER TABLE goal_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_recurring ENABLE ROW LEVEL SECURITY;

CREATE POLICY household_isolation ON goal_rewards FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid);
CREATE POLICY household_isolation ON goals FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
 AND EXISTS (SELECT 1 FROM household_members m WHERE m.id = owner_member_id AND m.household_id = goals.household_id));
CREATE POLICY household_isolation ON goal_milestones FOR ALL
 USING (EXISTS (SELECT 1 FROM goals g WHERE g.id = goal_id))
 WITH CHECK (EXISTS (SELECT 1 FROM goals g WHERE g.id = goal_id)
 AND (reward_id IS NULL OR EXISTS (SELECT 1 FROM goal_rewards r WHERE r.id = reward_id)));
CREATE POLICY household_isolation ON goal_progress_events FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
 AND EXISTS (SELECT 1 FROM goals g WHERE g.id = goal_id AND g.household_id = goal_progress_events.household_id));
CREATE POLICY household_isolation ON goal_reward_redemptions FOR ALL
 USING (EXISTS (SELECT 1 FROM goals g WHERE g.id = goal_id))
 WITH CHECK (EXISTS (SELECT 1 FROM goals g
   JOIN household_members m ON m.household_id = g.household_id AND m.id = member_id
   JOIN goal_rewards r ON r.household_id = g.household_id AND r.id = reward_id
   JOIN goal_milestones s ON s.goal_id = g.id AND s.id = milestone_id
   WHERE g.id = goal_reward_redemptions.goal_id));
CREATE POLICY household_isolation ON expense_recurring FOR ALL
 USING (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid)
 WITH CHECK (household_id = NULLIF(current_setting('app.current_household_id', true), '')::uuid
 AND (member_id IS NULL OR EXISTS (SELECT 1 FROM household_members m WHERE m.id = member_id AND m.household_id = expense_recurring.household_id)));

-- Explicit bootstrap/maintenance context; never granted to cross-tenant workers.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['goal_rewards','goals','goal_milestones','goal_progress_events','goal_reward_redemptions','expense_recurring'] LOOP
  EXECUTE format('CREATE POLICY system_bootstrap ON %I FOR ALL USING (current_setting(''app.system_access'', true) = ''true'') WITH CHECK (current_setting(''app.system_access'', true) = ''true'')', t);
 END LOOP;
END $$;
