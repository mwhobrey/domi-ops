CREATE TABLE "school_submission_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"artifact_type" varchar(16) NOT NULL,
	"s3_key" text,
	"url" text,
	"note" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_submission_artifacts" ADD CONSTRAINT "school_submission_artifacts_submission_id_school_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."school_submissions"("id") ON DELETE cascade ON UPDATE no action;
