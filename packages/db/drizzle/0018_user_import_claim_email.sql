ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "import_claim_email" varchar(320);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_import_claim_email_idx" ON "users" ("import_claim_email");
