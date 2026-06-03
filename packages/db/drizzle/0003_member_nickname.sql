ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "nickname" varchar(64);

ALTER TABLE "home_status" ADD COLUMN IF NOT EXISTS "member_id" uuid;

DO $$ BEGIN
  ALTER TABLE "home_status" ADD CONSTRAINT "home_status_member_id_household_members_id_fk"
    FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "home_status_household_member" ON "home_status" ("household_id", "member_id");
