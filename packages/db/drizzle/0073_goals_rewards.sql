DO $$ BEGIN
  CREATE TYPE "goal_progress_source_type" AS ENUM ('manual', 'chores', 'health', 'school');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "goal_redemption_status" AS ENUM ('pending', 'approved', 'denied');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "goal_rewards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "title" varchar(256) NOT NULL,
  "description" text,
  "archived_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "owner_member_id" uuid NOT NULL,
  "title" varchar(256) NOT NULL,
  "description" text,
  "visibility" "note_visibility" DEFAULT 'household' NOT NULL,
  "completed_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "goal_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "goal_id" uuid NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "threshold" real NOT NULL,
  "title" varchar(256) NOT NULL,
  "reward_id" uuid,
  "achieved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "goal_progress_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "goal_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "source_type" "goal_progress_source_type" DEFAULT 'manual' NOT NULL,
  "source_event_type" text,
  "amount" real NOT NULL,
  "note" text,
  "logged_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" uuid
);

CREATE TABLE IF NOT EXISTS "goal_reward_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "milestone_id" uuid NOT NULL,
  "goal_id" uuid NOT NULL,
  "reward_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "status" "goal_redemption_status" DEFAULT 'pending' NOT NULL,
  "claimed_by_user_id" uuid,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by_user_id" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text
);

DO $$ BEGIN
  ALTER TABLE "goal_rewards" ADD CONSTRAINT "goal_rewards_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_rewards" ADD CONSTRAINT "goal_rewards_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_member_id_household_members_id_fk"
    FOREIGN KEY ("owner_member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_goals_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_reward_id_goal_rewards_id_fk"
    FOREIGN KEY ("reward_id") REFERENCES "public"."goal_rewards"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_progress_events" ADD CONSTRAINT "goal_progress_events_goal_id_goals_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_progress_events" ADD CONSTRAINT "goal_progress_events_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_progress_events" ADD CONSTRAINT "goal_progress_events_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_reward_redemptions" ADD CONSTRAINT "goal_reward_redemptions_milestone_id_goal_milestones_id_fk"
    FOREIGN KEY ("milestone_id") REFERENCES "public"."goal_milestones"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_reward_redemptions" ADD CONSTRAINT "goal_reward_redemptions_goal_id_goals_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_reward_redemptions" ADD CONSTRAINT "goal_reward_redemptions_reward_id_goal_rewards_id_fk"
    -- No ON DELETE clause (defaults to NO ACTION) — deliberate backstop for the app-level 409
    -- `reward_in_use` guard on DELETE /api/goals/rewards/:id (redemption history must always
    -- know what reward it was for; see packages/db/src/schema/goals.ts).
    FOREIGN KEY ("reward_id") REFERENCES "public"."goal_rewards"("id") ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_reward_redemptions" ADD CONSTRAINT "goal_reward_redemptions_member_id_household_members_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_reward_redemptions" ADD CONSTRAINT "goal_reward_redemptions_claimed_by_user_id_users_id_fk"
    FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goal_reward_redemptions" ADD CONSTRAINT "goal_reward_redemptions_decided_by_user_id_users_id_fk"
    FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "goal_milestones_goal_sort" ON "goal_milestones" USING btree ("goal_id","sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "goal_reward_redemptions_milestone_unique" ON "goal_reward_redemptions" USING btree ("milestone_id");
