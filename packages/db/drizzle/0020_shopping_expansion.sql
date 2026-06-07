CREATE TABLE IF NOT EXISTS "shopping_recurring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"item" varchar(256) NOT NULL,
	"tags_json" text DEFAULT '[]',
	"quantity" real,
	"unit" varchar(32),
	"notes" text,
	"interval" varchar(16) DEFAULT 'weekly' NOT NULL,
	"next_at" date NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopping_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cleared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trip_total" real,
	"receipt_s3_key" text,
	"expense_id" uuid,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_by_display_name" varchar(64)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopping_trip_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"item" varchar(256) NOT NULL,
	"tags_json" text DEFAULT '[]',
	"quantity" real,
	"unit" varchar(32),
	"notes" text,
	"cost" real
);
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN IF NOT EXISTS "cost" real;
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN IF NOT EXISTS "recurring_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopping_recurring" ADD CONSTRAINT "shopping_recurring_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopping_trips" ADD CONSTRAINT "shopping_trips_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopping_trips" ADD CONSTRAINT "shopping_trips_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopping_trip_items" ADD CONSTRAINT "shopping_trip_items_trip_id_shopping_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."shopping_trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_recurring_id_shopping_recurring_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."shopping_recurring"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
