ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "unit" varchar(32);
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "target_date" date;
