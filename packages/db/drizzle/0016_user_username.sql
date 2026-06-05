ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" varchar(64);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_username" varchar(64);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username") WHERE "username" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_identifier_check" CHECK ("email" IS NOT NULL OR "username" IS NOT NULL);
