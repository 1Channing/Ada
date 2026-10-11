-- =========================================
-- VALIDATION SCRIPTS FOR SCHEDULED RUNS
-- =========================================
-- These queries help validate that the scheduling system
-- is running correctly with proper idempotency and no duplicates.
--
-- Run these queries regularly to monitor system health.
-- =========================================

-- =========================================
-- 1. CHECK FOR DUPLICATE STUDY RESULTS
-- =========================================
-- Should return 0 rows if unique constraint is working
-- If any duplicates found, investigate immediately
SELECT
  run_id,
  study_id,
  COUNT(*) as duplicate_count,
  ARRAY_AGG(id) as result_ids,
  ARRAY_AGG(created_at) as created_times
FROM study_run_results
GROUP BY run_id, study_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- =========================================
-- 2. CHECK FOR DUPLICATE LISTINGS
-- =========================================
-- Should return 0 rows if unique index is working
-- Duplicates here waste storage and confuse users
SELECT
  listing_url,
  run_result_id,
  COUNT(*) as duplicate_count,
  ARRAY_AGG(id) as listing_ids,
  ARRAY_AGG(title) as titles,
  ARRAY_AGG(price) as prices
FROM study_source_listings
WHERE listing_url IS NOT NULL AND listing_url != ''
GROUP BY listing_url, run_result_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- =========================================
-- 3. FIND STALE RUNNING JOBS
-- =========================================
-- These are jobs stuck in 'running' state
-- Should be automatically cleaned by cleanup_stale_jobs function
-- If this returns rows, cleanup may not be running
SELECT
  id,
  scheduled_at,
  last_run_at,
  last_heartbeat_at,
  last_updated_at,
  status,
  run_id,
  EXTRACT(EPOCH FROM (now() - last_updated_at))::integer / 60 as minutes_since_update,
  EXTRACT(EPOCH FROM (now() - COALESCE(last_heartbeat_at, last_updated_at)))::integer / 60 as minutes_since_heartbeat,
  payload->>'studyIds' as study_ids_count
FROM scheduled_study_runs
WHERE status = 'running'
AND (
  -- No heartbeat tracking, check overall runtime (2 hours)
  (last_heartbeat_at IS NULL
   AND last_updated_at < now() - interval '2 hours')
  OR
  -- Heartbeat active, check heartbeat freshness (10 minutes)
  (last_heartbeat_at IS NOT NULL
   AND last_heartbeat_at < now() - interval '10 minutes')
)
ORDER BY last_updated_at ASC;

-- =========================================
-- 4. FIND ORPHANED STUDY_RUNS
-- =========================================
-- These are instant runs stuck in 'running' state
-- Should be cleaned by cleanup_stale_jobs function
SELECT
  id,
  run_type,
  executed_at,
  last_heartbeat_at,
  last_updated_at,
  status,
  total_studies,
  EXTRACT(EPOCH FROM (now() - last_updated_at))::integer / 60 as minutes_since_update,
  EXTRACT(EPOCH FROM (now() - COALESCE(last_heartbeat_at, last_updated_at)))::integer / 60 as minutes_since_heartbeat
FROM study_runs
WHERE status = 'running'
AND (
  -- No heartbeat tracking, check overall runtime (2 hours)
  (last_heartbeat_at IS NULL
   AND last_updated_at < now() - interval '2 hours')
  OR
  -- Heartbeat active, check heartbeat freshness (10 minutes)
  (last_heartbeat_at IS NOT NULL
   AND last_heartbeat_at < now() - interval '10 minutes')
)
AND id NOT IN (
  SELECT run_id FROM scheduled_study_runs WHERE run_id IS NOT NULL
)
ORDER BY last_updated_at ASC;

-- =========================================
-- 5. CHECK SCHEDULED JOB SUCCESS RATE (LAST 7 DAYS)
-- =========================================
-- Should see mostly 'completed' status
-- High failure rate indicates system issues
SELECT
  status,
  COUNT(*) as job_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
  AVG(execution_duration_ms) / 1000 as avg_duration_seconds,
  MIN(execution_duration_ms) / 1000 as min_duration_seconds,
  MAX(execution_duration_ms) / 1000 as max_duration_seconds
FROM scheduled_study_runs
WHERE scheduled_at > now() - interval '7 days'
GROUP BY status
ORDER BY job_count DESC;

-- =========================================
-- 6. CHECK RECENT JOB EXECUTION TIMES
-- =========================================
-- Monitor for slow jobs or timeouts
SELECT
  DATE(scheduled_at) as date,
  COUNT(*) as total_jobs,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'running') as still_running,
  ROUND(AVG(execution_duration_ms) / 1000, 2) as avg_duration_sec,
  ROUND(MAX(execution_duration_ms) / 1000, 2) as max_duration_sec
FROM scheduled_study_runs
WHERE scheduled_at > now() - interval '7 days'
GROUP BY DATE(scheduled_at)
ORDER BY date DESC;

-- =========================================
-- 7. VERIFY HEARTBEAT TRACKING IS ACTIVE
-- =========================================
-- Recent completed jobs should have heartbeat data
-- If all NULL, heartbeat mechanism may not be working
SELECT
  id,
  scheduled_at,
  status,
  last_run_at,
  last_heartbeat_at,
  execution_duration_ms / 1000 as duration_seconds,
  CASE
    WHEN last_heartbeat_at IS NOT NULL THEN 'Has heartbeat'
    ELSE 'No heartbeat'
  END as heartbeat_status
FROM scheduled_study_runs
WHERE scheduled_at > now() - interval '24 hours'
AND status IN ('completed', 'failed')
ORDER BY scheduled_at DESC
LIMIT 20;

-- =========================================
-- 8. CHECK FOR IDEMPOTENCY KEY USAGE
-- =========================================
-- Future feature: should show idempotency keys in use
-- Currently may return all NULL if not yet implemented
SELECT
  idempotency_key,
  COUNT(*) as usage_count,
  MIN(scheduled_at) as first_scheduled,
  MAX(scheduled_at) as last_scheduled,
  ARRAY_AGG(DISTINCT status) as statuses
FROM scheduled_study_runs
WHERE scheduled_at > now() - interval '7 days'
AND idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1
ORDER BY usage_count DESC;

-- =========================================
-- 9. OVERALL SYSTEM HEALTH SUMMARY
-- =========================================
-- Quick overview of system state
WITH stats AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
    COUNT(*) FILTER (WHERE status = 'running') as running_jobs,
    COUNT(*) FILTER (WHERE status = 'completed' AND scheduled_at > now() - interval '24 hours') as completed_last_24h,
    COUNT(*) FILTER (WHERE status = 'failed' AND scheduled_at > now() - interval '24 hours') as failed_last_24h,
    COUNT(*) FILTER (
      WHERE status = 'running'
      AND (
        (last_heartbeat_at IS NULL AND last_updated_at < now() - interval '2 hours')
        OR
        (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < now() - interval '10 minutes')
      )
    ) as stale_jobs
  FROM scheduled_study_runs
),
orphaned AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'running') as running_study_runs,
    COUNT(*) FILTER (
      WHERE status = 'running'
      AND (
        (last_heartbeat_at IS NULL AND last_updated_at < now() - interval '2 hours')
        OR
        (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < now() - interval '10 minutes')
      )
      AND id NOT IN (SELECT run_id FROM scheduled_study_runs WHERE run_id IS NOT NULL)
    ) as stale_orphaned_runs
  FROM study_runs
)
SELECT
  now() as check_time,
  pending_jobs,
  running_jobs,
  stale_jobs,
  stale_orphaned_runs,
  completed_last_24h,
  failed_last_24h,
  CASE
    WHEN stale_jobs > 0 OR stale_orphaned_runs > 0 THEN '⚠️  UNHEALTHY - Stale jobs detected'
    WHEN running_jobs > 5 THEN '⚠️  WARNING - Many jobs running'
    WHEN failed_last_24h > completed_last_24h THEN '⚠️  WARNING - High failure rate'
    ELSE '✅ HEALTHY'
  END as health_status,
  CASE
    WHEN stale_jobs > 0 OR stale_orphaned_runs > 0
    THEN 'Run cleanup_stale_jobs function immediately'
    WHEN running_jobs > 5
    THEN 'Check if jobs are progressing or stuck'
    WHEN failed_last_24h > completed_last_24h
    THEN 'Investigate recent failures'
    ELSE 'System operating normally'
  END as recommendation
FROM stats, orphaned;

-- =========================================
-- 10. MANUAL CLEANUP (USE WITH CAUTION)
-- =========================================
-- Only run this if automatic cleanup is not working
-- This will mark ALL stale jobs as failed

-- UNCOMMENT TO RUN:
-- SELECT * FROM cleanup_stale_jobs();

-- =========================================
-- 11. MARK SPECIFIC JOB AS FAILED (EMERGENCY)
-- =========================================
-- Replace <job_id> with actual UUID if you need to manually mark a job as failed

-- UNCOMMENT AND REPLACE <job_id> TO RUN:
-- UPDATE scheduled_study_runs
-- SET status = 'failed', last_error = 'Manually marked as failed'
-- WHERE id = '<job_id>' AND status = 'running';
