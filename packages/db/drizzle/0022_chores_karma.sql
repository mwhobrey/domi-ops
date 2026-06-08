CREATE TABLE IF NOT EXISTS "chore_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_id" uuid,
	"member_id" uuid,
	"description" text NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"karma_earned" integer DEFAULT 0 NOT NULL,
	"timing" varchar(16) NOT NULL,
	"days_late" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chore_member_karma" (
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"karma_points" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"redemption_quests_completed" integer DEFAULT 0 NOT NULL,
	"last_completion_date" date,
	CONSTRAINT "chore_member_karma_pk" PRIMARY KEY("household_id","member_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chore_completions" ADD CONSTRAINT "chore_completions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chore_completions" ADD CONSTRAINT "chore_completions_chore_id_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chores"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chore_completions" ADD CONSTRAINT "chore_completions_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chore_member_karma" ADD CONSTRAINT "chore_member_karma_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chore_member_karma" ADD CONSTRAINT "chore_member_karma_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chore_completions_household_completed_at_idx" ON "chore_completions" ("household_id","completed_at");
