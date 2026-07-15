CREATE TABLE IF NOT EXISTS school_submission_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  submission_id uuid NOT NULL REFERENCES school_submissions(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES school_assignment_materials(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES school_test_questions(id) ON DELETE CASCADE,
  turn_in_number integer NOT NULL,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_score real,
  manual_score real,
  graded_by_user_id uuid REFERENCES users(id),
  graded_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS school_submission_responses_unique
  ON school_submission_responses (submission_id, question_id, turn_in_number);
