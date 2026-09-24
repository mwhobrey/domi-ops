ALTER TABLE "calendar_events" ADD COLUMN "location" varchar(512);--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "attendee_member_ids" uuid[];--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "location" varchar(512);--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "attendee_member_ids" uuid[];--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "time_zone" varchar(64);--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "duration_days" integer DEFAULT 0 NOT NULL;
