ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_school_reminders_enabled" boolean NOT NULL DEFAULT true;

ALTER TABLE "school_assignments" ADD COLUMN IF NOT EXISTS "due_reminder_sent_at" timestamp with time zone;
