-- WHO-280: one dose log per medication per scheduled instant.
--
-- Before this, five code paths wrote health_medication_logs and only three checked for an
-- existing row first, so a skip-then-take-all (or a fast double-tap) could leave two rows for
-- the same (medication_id, scheduled_at) — reports then counted the dose twice. recordDose()
-- (apps/api/src/lib/health-med-logging.ts) is now the single writer and relies on this index
-- as its conflict target.
--
-- PRN doses have scheduled_at NULL and stay exempt: "as needed" is genuinely many-per-day,
-- each take its own row.

-- Dedupe first, or the index creation fails on live data. Keep the most recently logged row
-- per (medication_id, scheduled_at); on a tie, keep the higher id. A "taken" and a "skipped"
-- for the same instant is exactly the bug this fixes — last action logged wins, matching the
-- new single-action-overrides rule.
DELETE FROM health_medication_logs a
USING health_medication_logs b
WHERE a.medication_id = b.medication_id
  AND a.scheduled_at IS NOT NULL
  AND a.scheduled_at = b.scheduled_at
  AND (a.logged_at < b.logged_at
       OR (a.logged_at = b.logged_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS health_medication_logs_instant_unique
  ON health_medication_logs (medication_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;
