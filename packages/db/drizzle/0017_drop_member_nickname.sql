ALTER TABLE "household_members" DROP COLUMN IF EXISTS "nickname";
--> statement-breakpoint
ALTER TABLE "household_members" DROP COLUMN IF EXISTS "public_label";
--> statement-breakpoint
DROP TYPE IF EXISTS "member_public_label";
