DO $$ BEGIN
 CREATE TYPE "public"."drive_object_kind" AS ENUM('file', 'link');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_parent_id_drive_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_folders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"folder_id" uuid,
	"kind" "drive_object_kind" NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"url" text,
	"s3_key" text,
	"content_type" varchar(128),
	"byte_size" integer,
	"pinned" boolean DEFAULT false NOT NULL,
	"tags_json" text DEFAULT '[]',
	"visibility" "note_visibility" DEFAULT 'household' NOT NULL,
	"created_by_user_id" uuid,
	"created_by_display_name" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_objects" ADD CONSTRAINT "drive_objects_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_objects" ADD CONSTRAINT "drive_objects_folder_id_drive_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."drive_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_objects" ADD CONSTRAINT "drive_objects_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_shares" (
	"drive_object_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_shares_drive_object_id_member_id_pk" PRIMARY KEY("drive_object_id","member_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_shares" ADD CONSTRAINT "drive_shares_drive_object_id_drive_objects_id_fk" FOREIGN KEY ("drive_object_id") REFERENCES "public"."drive_objects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_shares" ADD CONSTRAINT "drive_shares_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_object_id" uuid NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_references" ADD CONSTRAINT "drive_references_drive_object_id_drive_objects_id_fk" FOREIGN KEY ("drive_object_id") REFERENCES "public"."drive_objects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_references" ADD CONSTRAINT "drive_references_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drive_references_object_entity" ON "drive_references" ("drive_object_id","entity_type","entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drive_share_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_object_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone,
	"password_hash" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_share_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_share_tokens" ADD CONSTRAINT "drive_share_tokens_drive_object_id_drive_objects_id_fk" FOREIGN KEY ("drive_object_id") REFERENCES "public"."drive_objects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "storage_quota_bytes" bigint;
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "storage_used_bytes" bigint DEFAULT 0 NOT NULL;
