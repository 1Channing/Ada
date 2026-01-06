/*
  # Add Scheduling Robustness and Idempotency

  This migration adds critical safeguards for reliable overnight scheduled runs:

  1. **Duplicate Prevention**
     - Unique constraint on study_run_results(run_id, study_id) - prevents same study being stored twice in same run
     - Partial unique index on study_source_listings(listing_url, run_result_id) - prevents duplicate listings

  2. **Stale Job Detection**
     - last_heartbeat_at column to track worker liveness
     - last_updated_at column for status change tracking
     - Automated cleanup function for stale jobs

  3. **Job Idempotency**
     - idempotency_key on scheduled_study_runs to prevent duplicate processing from cron misfires

  4. **Improved Observability**
     - execution_duration_ms for performance tracking
     - Better indexing for monitoring queries

  5. **Cleanup Functions**
     - mark_stale_scheduled_runs() - marks jobs stuck in 'running' as failed
     - clean_orphaned_study_runs() - marks study_runs stuck in 'running' as error

  ## Security
  - All new columns have appropriate defaults
  - RLS policies unchanged (maintained compatibility)
  - Functions are SECURITY DEFINER for automated cleanup
*/

-- =========================================
-- PART 1: Add Duplicate Prevention
-- =========================================

-- Prevent duplicate results for same study in same run
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_run_study'
  ) THEN
    ALTER TABLE study_run_results
    ADD CONSTRAINT unique_run_study UNIQUE(run_id, study_id);
  END IF;
END $$;

-- Prevent duplicate listings per result
CREATE UNIQUE INDEX IF NOT EXISTS unique_listing_per_result
ON study_source_listings(listing_url, run_result_id)
WHERE listing_url IS NOT NULL AND listing_url != '';

-- =========================================
-- PART 2: Add Heartbeat and Tracking Columns
-- =========================================

-- Track when running jobs last sent a heartbeat (liveness check)
ALTER TABLE scheduled_study_runs
ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

-- Track when status was last changed
ALTER TABLE scheduled_study_runs
ADD COLUMN IF NOT EXISTS last_updated_at timestamptz DEFAULT now();

-- Track execution duration for performance monitoring
ALTER TABLE scheduled_study_runs
ADD COLUMN IF NOT EXISTS execution_duration_ms integer;

-- Add heartbeat tracking to study_runs as well
ALTER TABLE study_runs
ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

ALTER TABLE study_runs
ADD COLUMN IF NOT EXISTS last_updated_at timestamptz DEFAULT now();

-- =========================================
-- PART 3: Add Idempotency Key
-- =========================================

-- Prevent duplicate processing from cron misfires
ALTER TABLE scheduled_study_runs
ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE INDEX IF NOT EXISTS idx_scheduled_study_runs_idempotency
ON scheduled_study_runs(idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- =========================================
-- PART 4: Improve Existing Indexes
-- =========================================

-- Optimize queries for monitoring running jobs
CREATE INDEX IF NOT EXISTS idx_scheduled_study_runs_running
ON scheduled_study_runs(status, last_updated_at)
WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_study_runs_running
ON study_runs(status, last_updated_at)
WHERE status = 'running';

-- Optimize queries for stale job detection
CREATE INDEX IF NOT EXISTS idx_scheduled_study_runs_heartbeat
ON scheduled_study_runs(status, last_heartbeat_at)
WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_study_runs_heartbeat
ON study_runs(status, last_heartbeat_at)
WHERE status = 'running';

-- =========================================
-- PART 5: Create Trigger to Update last_updated_at
-- =========================================

CREATE OR REPLACE FUNCTION update_last_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.last_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_scheduled_study_runs_updated ON scheduled_study_runs;
CREATE TRIGGER trigger_scheduled_study_runs_updated
  BEFORE UPDATE ON scheduled_study_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_last_updated_at();

DROP TRIGGER IF EXISTS trigger_study_runs_updated ON study_runs;
CREATE TRIGGER trigger_study_runs_updated
  BEFORE UPDATE ON study_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_last_updated_at();

-- =========================================
-- PART 6: Stale Job Cleanup Functions
-- =========================================

CREATE OR REPLACE FUNCTION mark_stale_scheduled_runs(
  timeout_seconds integer DEFAULT 7200,
  heartbeat_timeout_seconds integer DEFAULT 600
)
RETURNS TABLE (
  marked_count integer,
  job_ids uuid[],
  job_details jsonb
)
SECURITY DEFINER
AS $$
DECLARE
  v_marked_count integer;
  v_job_ids uuid[];
  v_job_details jsonb;
BEGIN
  WITH stale_jobs AS (
    SELECT
      id,
      scheduled_at,
      last_run_at,
      last_heartbeat_at,
      last_updated_at,
      run_id,
      payload
    FROM scheduled_study_runs
    WHERE status = 'running'
    AND (
      (last_heartbeat_at IS NULL
       AND last_updated_at < now() - (timeout_seconds || ' seconds')::interval)
      OR
      (last_heartbeat_at IS NOT NULL
       AND last_heartbeat_at < now() - (heartbeat_timeout_seconds || ' seconds')::interval)
    )
  ),
  updated AS (
    UPDATE scheduled_study_runs
    SET
      status = 'failed',
      last_error = 'Job marked as stale - no heartbeat for ' ||
                   CASE
                     WHEN last_heartbeat_at IS NOT NULL
                     THEN heartbeat_timeout_seconds
                     ELSE timeout_seconds
                   END || ' seconds',
      last_updated_at = now()
    WHERE id IN (SELECT id FROM stale_jobs)
    RETURNING id
  ),
  aggregated AS (
    SELECT
      COUNT(*)::integer as cnt,
      ARRAY_AGG(s.id) as ids,
      jsonb_agg(jsonb_build_object(
        'id', s.id,
        'scheduled_at', s.scheduled_at,
        'last_run_at', s.last_run_at,
        'last_heartbeat_at', s.last_heartbeat_at,
        'last_updated_at', s.last_updated_at,
        'run_id', s.run_id,
        'study_ids', (s.payload->>'studyIds')::jsonb
      )) as details
    FROM stale_jobs s
  )
  SELECT
    COALESCE(cnt, 0),
    COALESCE(ids, ARRAY[]::uuid[]),
    COALESCE(details, '[]'::jsonb)
  INTO v_marked_count, v_job_ids, v_job_details
  FROM aggregated;

  IF v_marked_count > 0 THEN
    UPDATE study_runs
    SET
      status = 'error',
      error_message = 'Marked as stale due to parent scheduled job timeout',
      last_updated_at = now()
    WHERE id IN (
      SELECT run_id
      FROM scheduled_study_runs
      WHERE id = ANY(v_job_ids)
      AND run_id IS NOT NULL
    )
    AND status = 'running';
  END IF;

  RETURN QUERY SELECT v_marked_count, v_job_ids, v_job_details;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION clean_orphaned_study_runs(
  timeout_seconds integer DEFAULT 7200,
  heartbeat_timeout_seconds integer DEFAULT 600
)
RETURNS TABLE (
  marked_count integer,
  run_ids uuid[],
  run_details jsonb
)
SECURITY DEFINER
AS $$
DECLARE
  v_marked_count integer;
  v_run_ids uuid[];
  v_run_details jsonb;
BEGIN
  WITH stale_runs AS (
    SELECT
      id,
      run_type,
      executed_at,
      last_heartbeat_at,
      last_updated_at,
      total_studies
    FROM study_runs
    WHERE status = 'running'
    AND (
      (last_heartbeat_at IS NULL
       AND last_updated_at < now() - (timeout_seconds || ' seconds')::interval)
      OR
      (last_heartbeat_at IS NOT NULL
       AND last_heartbeat_at < now() - (heartbeat_timeout_seconds || ' seconds')::interval)
    )
    AND id NOT IN (
      SELECT run_id FROM scheduled_study_runs WHERE run_id IS NOT NULL
    )
  ),
  updated AS (
    UPDATE study_runs
    SET
      status = 'error',
      error_message = 'Run marked as stale - no heartbeat for ' ||
                      CASE
                        WHEN last_heartbeat_at IS NOT NULL
                        THEN heartbeat_timeout_seconds
                        ELSE timeout_seconds
                      END || ' seconds',
      last_updated_at = now()
    WHERE id IN (SELECT id FROM stale_runs)
    RETURNING id
  ),
  aggregated AS (
    SELECT
      COUNT(*)::integer as cnt,
      ARRAY_AGG(s.id) as ids,
      jsonb_agg(jsonb_build_object(
        'id', s.id,
        'run_type', s.run_type,
        'executed_at', s.executed_at,
        'last_heartbeat_at', s.last_heartbeat_at,
        'last_updated_at', s.last_updated_at,
        'total_studies', s.total_studies
      )) as details
    FROM stale_runs s
  )
  SELECT
    COALESCE(cnt, 0),
    COALESCE(ids, ARRAY[]::uuid[]),
    COALESCE(details, '[]'::jsonb)
  INTO v_marked_count, v_run_ids, v_run_details
  FROM aggregated;

  RETURN QUERY SELECT v_marked_count, v_run_ids, v_run_details;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_stale_jobs(
  timeout_seconds integer DEFAULT 7200,
  heartbeat_timeout_seconds integer DEFAULT 600
)
RETURNS jsonb
SECURITY DEFINER
AS $$
DECLARE
  v_scheduled_result record;
  v_orphaned_result record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_scheduled_result
  FROM mark_stale_scheduled_runs(timeout_seconds, heartbeat_timeout_seconds);

  SELECT * INTO v_orphaned_result
  FROM clean_orphaned_study_runs(timeout_seconds, heartbeat_timeout_seconds);

  v_result := jsonb_build_object(
    'timestamp', now(),
    'scheduled_jobs_cleaned', v_scheduled_result.marked_count,
    'scheduled_job_ids', v_scheduled_result.job_ids,
    'scheduled_job_details', v_scheduled_result.job_details,
    'orphaned_runs_cleaned', v_orphaned_result.marked_count,
    'orphaned_run_ids', v_orphaned_result.run_ids,
    'orphaned_run_details', v_orphaned_result.run_details,
    'total_cleaned', v_scheduled_result.marked_count + v_orphaned_result.marked_count
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- PART 7: Monitoring Views
-- =========================================

CREATE OR REPLACE VIEW v_running_scheduled_jobs AS
SELECT
  s.id,
  s.scheduled_at,
  s.last_run_at,
  s.last_heartbeat_at,
  s.last_updated_at,
  s.status,
  s.run_id,
  r.total_studies,
  r.null_count,
  r.opportunities_count,
  EXTRACT(EPOCH FROM (now() - s.last_updated_at))::integer as seconds_since_update,
  EXTRACT(EPOCH FROM (now() - COALESCE(s.last_heartbeat_at, s.last_updated_at)))::integer as seconds_since_heartbeat,
  (s.payload->>'studyIds')::jsonb as study_ids,
  (s.payload->>'threshold')::integer as threshold
FROM scheduled_study_runs s
LEFT JOIN study_runs r ON s.run_id = r.id
WHERE s.status = 'running'
ORDER BY s.last_updated_at DESC;

CREATE OR REPLACE VIEW v_stale_scheduled_jobs AS
SELECT
  *,
  CASE
    WHEN last_heartbeat_at IS NOT NULL AND seconds_since_heartbeat > 600
    THEN 'STALE - No heartbeat for ' || seconds_since_heartbeat || 's'
    WHEN last_heartbeat_at IS NULL AND seconds_since_update > 7200
    THEN 'STALE - Running for ' || seconds_since_update || 's'
    ELSE 'OK'
  END as health_status
FROM v_running_scheduled_jobs
WHERE
  (last_heartbeat_at IS NOT NULL AND seconds_since_heartbeat > 600)
  OR
  (last_heartbeat_at IS NULL AND seconds_since_update > 7200);

CREATE OR REPLACE VIEW v_scheduled_job_stats AS
SELECT
  DATE(scheduled_at) as schedule_date,
  status,
  COUNT(*) as job_count,
  AVG(execution_duration_ms) as avg_duration_ms,
  MAX(execution_duration_ms) as max_duration_ms,
  MIN(execution_duration_ms) as min_duration_ms
FROM scheduled_study_runs
WHERE scheduled_at > now() - interval '30 days'
GROUP BY DATE(scheduled_at), status
ORDER BY schedule_date DESC, status;

COMMENT ON FUNCTION mark_stale_scheduled_runs IS 'Marks scheduled jobs stuck in running state as failed. Default: 2hr timeout, 10min heartbeat timeout.';
COMMENT ON FUNCTION clean_orphaned_study_runs IS 'Marks orphaned study_runs (instant runs) stuck in running state as error.';
COMMENT ON FUNCTION cleanup_stale_jobs IS 'Combined cleanup: marks all stale scheduled jobs and orphaned runs as failed/error.';
