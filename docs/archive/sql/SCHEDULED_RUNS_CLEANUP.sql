/*
  Cleanup orphaned scheduled runs and study_runs records

  This script:
  1. Marks stuck "running" study_runs as "failed"
  2. Marks stuck "running" scheduled_study_runs as "failed"
  3. Provides diagnostic queries
*/

-- 1. Mark orphaned study_runs (stuck in "running" or "pending" status) as error
UPDATE study_runs
SET
  status = 'error',
  error_message = 'Cleanup: Job was stuck in running/pending status'
WHERE
  run_type = 'scheduled'
  AND status IN ('running', 'pending')
  AND (
    executed_at IS NULL
    OR executed_at < NOW() - INTERVAL '1 hour'
  );

-- 2. Mark orphaned scheduled_study_runs (stuck in "running" status) as failed
UPDATE scheduled_study_runs
SET
  status = 'failed',
  last_error = 'Cleanup: Job was stuck in running status'
WHERE
  status = 'running'
  AND last_run_at < NOW() - INTERVAL '1 hour';

-- 3. Diagnostic queries
-- Show recent scheduled runs with their status
SELECT
  id,
  scheduled_at,
  status,
  payload->>'studyIds' as study_ids,
  (payload->'studyIds')::jsonb as study_ids_array,
  jsonb_array_length(payload->'studyIds') as study_count,
  payload->>'threshold' as threshold,
  payload->>'scrapeMode' as scrape_mode,
  last_error,
  run_id,
  last_run_at
FROM scheduled_study_runs
ORDER BY created_at DESC
LIMIT 10;

-- Show recent study_runs and their linkage
SELECT
  sr.id as run_id,
  sr.run_type,
  sr.status,
  sr.total_studies,
  sr.null_count,
  sr.opportunities_count,
  sr.executed_at,
  sr.error_message,
  s.id as scheduled_id,
  s.status as scheduled_status
FROM study_runs sr
LEFT JOIN scheduled_study_runs s ON s.run_id = sr.id
WHERE sr.run_type = 'scheduled'
ORDER BY sr.executed_at DESC NULLS FIRST
LIMIT 10;

-- Count results per run
SELECT
  run_id,
  COUNT(*) as results_count,
  COUNT(*) FILTER (WHERE status = 'OPPORTUNITIES') as opportunities,
  COUNT(*) FILTER (WHERE status = 'NULL') as nulls,
  COUNT(*) FILTER (WHERE status = 'TARGET_BLOCKED') as blocked
FROM study_run_results
WHERE run_id IN (
  SELECT id FROM study_runs
  WHERE run_type = 'scheduled'
  ORDER BY executed_at DESC NULLS FIRST
  LIMIT 5
)
GROUP BY run_id;
