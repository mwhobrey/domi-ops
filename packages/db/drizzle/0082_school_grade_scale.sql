-- WHO-347: there is no universal grade scale, so transcripts use a per-household one.
-- Shape: { "passingPercent": 60, "bands": [{ "min": 90, "letter": "A", "points": 4 }, ...] }.
-- Null = the default 90/80/70/60 scale (defined in apps/api/src/lib/school-transcript-math.ts).
ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "school_grade_scale" jsonb;
