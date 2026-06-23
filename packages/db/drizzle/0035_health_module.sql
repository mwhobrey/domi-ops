DO $$ BEGIN
  CREATE TYPE "health_event_type" AS ENUM('sickness', 'injury', 'appointment', 'symptom', 'medication', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "med_schedule_kind" AS ENUM('scheduled', 'prn');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "med_log_status" AS ENUM('taken', 'skipped', 'missed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "push_health_reminders_enabled" boolean DEFAULT true NOT NULL;

CREATE TABLE IF NOT EXISTS "health_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "medication_id" uuid,
  "type" "health_event_type" DEFAULT 'other' NOT NULL,
  "title" text NOT NULL,
  "notes" text,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "visibility" "note_visibility" DEFAULT 'household' NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "health_event_shares" (
  "event_id" uuid NOT NULL REFERENCES "health_events"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  CONSTRAINT "health_event_shares_pkey" PRIMARY KEY("event_id","member_id")
);

CREATE TABLE IF NOT EXISTS "health_medications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "dosage" text,
  "instructions" text,
  "schedule_kind" "med_schedule_kind" DEFAULT 'scheduled' NOT NULL,
  "schedule_json" text DEFAULT '{}',
  "reminder_offsets_json" text DEFAULT '[0]',
  "start_date" date,
  "end_date" date,
  "enabled" boolean DEFAULT true NOT NULL,
  "visibility" "note_visibility" DEFAULT 'household' NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "health_medication_shares" (
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "household_members"("id") ON DELETE cascade,
  CONSTRAINT "health_medication_shares_pkey" PRIMARY KEY("medication_id","member_id")
);

CREATE TABLE IF NOT EXISTS "health_medication_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "scheduled_at" timestamp with time zone,
  "status" "med_log_status" NOT NULL,
  "logged_at" timestamp with time zone DEFAULT now() NOT NULL,
  "logged_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "notes" text,
  "health_event_id" uuid REFERENCES "health_events"("id") ON DELETE set null
);

CREATE TABLE IF NOT EXISTS "health_med_reminder_sent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "medication_id" uuid NOT NULL REFERENCES "health_medications"("id") ON DELETE cascade,
  "scheduled_at" timestamp with time zone NOT NULL,
  "offset_minutes" integer NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "health_med_reminder_sent_unique"
  ON "health_med_reminder_sent" ("medication_id", "scheduled_at", "offset_minutes");

ALTER TABLE "health_events"
  ADD CONSTRAINT "health_events_medication_id_fk"
  FOREIGN KEY ("medication_id") REFERENCES "health_medications"("id") ON DELETE set null;
