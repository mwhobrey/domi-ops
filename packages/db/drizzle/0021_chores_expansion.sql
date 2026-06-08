CREATE TABLE IF NOT EXISTS "chores_recurring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"description" text NOT NULL,
	"tags_json" text DEFAULT '[]',
	"priority" smallint DEFAULT 0 NOT NULL,
	"assignee_member_id" uuid,
	"interval" varchar(16) DEFAULT 'weekly' NOT NULL,
	"next_at" date NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chores" ADD COLUMN IF NOT EXISTS "assignee_member_id" uuid;
--> statement-breakpoint
ALTER TABLE "chores" ADD COLUMN IF NOT EXISTS "priority" smallint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "chores" ADD COLUMN IF NOT EXISTS "recurring_id" uuid;
--> statement-breakpoint
ALTER TABLE "chores" ADD COLUMN IF NOT EXISTS "due_reminder_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_chores_reminders_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chores_recurring" ADD CONSTRAINT "chores_recurring_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chores_recurring" ADD CONSTRAINT "chores_recurring_assignee_member_id_household_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chores" ADD CONSTRAINT "chores_assignee_member_id_household_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chores" ADD CONSTRAINT "chores_recurring_id_chores_recurring_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."chores_recurring"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
