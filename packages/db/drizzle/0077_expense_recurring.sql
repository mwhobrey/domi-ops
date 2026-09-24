CREATE TABLE "expense_recurring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"amount" real NOT NULL,
	"category" varchar(64),
	"member_id" uuid,
	"interval" varchar(16) DEFAULT 'monthly' NOT NULL,
	"anchor_date" date NOT NULL,
	"next_at" date NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_display_name" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_recurring" ADD CONSTRAINT "expense_recurring_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_recurring" ADD CONSTRAINT "expense_recurring_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurring_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_id_expense_recurring_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."expense_recurring"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_date" ON "expenses" USING btree ("recurring_id","expense_date");
