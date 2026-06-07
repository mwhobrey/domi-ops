ALTER TABLE "shopping_items" ADD COLUMN IF NOT EXISTS "quantity" real;
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD COLUMN IF NOT EXISTS "unit" varchar(32);
