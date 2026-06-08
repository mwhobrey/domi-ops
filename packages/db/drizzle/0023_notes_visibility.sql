DO $$ BEGIN
 CREATE TYPE "public"."note_visibility" AS ENUM('household', 'private');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "visibility" "note_visibility" DEFAULT 'household' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
