CREATE TABLE IF NOT EXISTS "calendar_category_import_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"linked_calendar_id" uuid NOT NULL,
	"source_key" varchar(128) NOT NULL,
	"source_label" varchar(128),
	"target_key" varchar(64),
	"target_label" varchar(128),
	"target_color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_category_import_mappings" ADD CONSTRAINT "calendar_category_import_mappings_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_category_import_mappings" ADD CONSTRAINT "calendar_category_import_mappings_linked_calendar_id_linked_google_calendars_id_fk" FOREIGN KEY ("linked_calendar_id") REFERENCES "public"."linked_google_calendars"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_category_import_conn_linked_source" ON "calendar_category_import_mappings" USING btree ("connection_id","linked_calendar_id","source_key");
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "sync_run_status" varchar(24) DEFAULT 'idle' NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "sync_run_progress" text;
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "sync_run_error" text;
