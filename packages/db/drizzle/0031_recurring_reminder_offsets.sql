ALTER TABLE "recurring_rules" ADD COLUMN IF NOT EXISTS "reminder_offsets_json" jsonb;
